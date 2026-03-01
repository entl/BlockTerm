package session

import (
	"fmt"
	"os"
	"path/filepath"
)

// ShellMarkers defines unique markers for detecting command boundaries.
// Plain-text ASCII sequences are used so they survive any terminal
// transport without being swallowed by escape-sequence strippers.
type ShellMarkers struct {
	CommandStart string // Marker printed immediately before command output
	CommandEnd   string // Marker printed after command finishes (fmt.Sprintf with exit code)
	PromptStart  string // Marker printed when the prompt is displayed
}

// DefaultMarkers returns the default shell markers.
func DefaultMarkers() ShellMarkers {
	return ShellMarkers{
		CommandStart: "<<<BLOCKTERM:START>>>",
		CommandEnd:   "<<<BLOCKTERM:END exit=%d>>>",
		PromptStart:  "<<<BLOCKTERM:PROMPT>>>",
	}
}

// getBashZshInit returns the shell initialization code for bash/zsh.
// It sources the user's existing rc file first so normal aliases and
// settings are preserved, then installs the BlockTerm hooks.
func getBashZshInit() string {
	return `# BlockTerm shell integration
export BLOCKTERM_SHELL_INTEGRATION=1
__blockterm_started=0

# precmd – fires after each command, before the prompt.
# We capture $? immediately so nothing can clobber it.
__blockterm_precmd() {
  local __bt_exit=$?
  if [[ "$__blockterm_started" == "1" ]]; then
    printf '<<<BLOCKTERM:END exit=%d>>>' "$__bt_exit"
    __blockterm_started=0
  fi
  # OSC 7: broadcast current working directory so the UI can track cwd.
  printf '\e]7;file://%s%s\e\\' "${HOSTNAME:-$(hostname 2>/dev/null)}" "$PWD"
}

# preexec – fires just before a command is executed.
__blockterm_preexec() {
  __blockterm_started=1
  printf '<<<BLOCKTERM:START>>>'
}

# For zsh
if [[ -n "${ZSH_VERSION}" ]]; then
  [[ -f ~/.zshrc ]] && source ~/.zshrc
  # Disable the % indicator for commands without trailing newline
  unsetopt PROMPT_SP
  autoload -Uz add-zsh-hook
  add-zsh-hook precmd  __blockterm_precmd
  add-zsh-hook preexec __blockterm_preexec

# For bash
elif [[ -n "${BASH_VERSION}" ]]; then
  [[ -f ~/.bashrc ]] && source ~/.bashrc
  # DEBUG trap fires before each interactive command.
  # Guard against re-entry so pipelines only emit one START.
  __blockterm_debug_handler() {
    if [[ "$__blockterm_started" == "0" ]]; then
      __blockterm_preexec
    fi
  }
  trap '__blockterm_debug_handler' DEBUG
  PROMPT_COMMAND="__blockterm_precmd${PROMPT_COMMAND:+;$PROMPT_COMMAND}"
fi
`
}

// getPowerShellInit returns the PowerShell profile initialization code.
func getPowerShellInit() string {
	// PowerShell uses backtick as its escape character (`e = ESC), which would
	// terminate Go's raw-string literal. Embed ESC directly with \x1b instead.
	const psOsc7 = "    [System.Console]::Out.Write(\"\x1b]7;file://$env:COMPUTERNAME$($PWD.Path.Replace('\\','/'))\x1b\\\")\n"
	return `# BlockTerm shell integration for PowerShell
$env:BLOCKTERM_SHELL_INTEGRATION = "1"

function __BlockTerm-PreExec {
    [System.Console]::Out.Write("<<<BLOCKTERM:START>>>")
}

function __BlockTerm-PreCmd {
    param([int]$ExitCode)
    [System.Console]::Out.Write("<<<BLOCKTERM:END exit=$ExitCode>>>")
}

# Preserve the original prompt
$__bt_originalPrompt = if (Test-Path Function:\prompt) { $function:prompt } else { { "PS> " } }

function prompt {
    $__bt_exit = $LASTEXITCODE
    __BlockTerm-PreCmd -ExitCode $__bt_exit
    # OSC 7: broadcast current working directory.
` + psOsc7 + `    & $__bt_originalPrompt
}

# Hook command execution via the Engine event
$null = Register-EngineEvent -SourceIdentifier ([System.Management.Automation.PsEngineEvent]::OnIdle) -Action {}
$ExecutionContext.InvokeCommand.PreCommandLookupAction = {
    param($commandName, $eventArgs)
    if ($commandName -notmatch '^__BlockTerm') {
        __BlockTerm-PreExec
    }
}`
}

// getInitializationScript returns the shell initialization code for the
// given shell *name* (not full path – use filepath.Base before calling).
func getInitializationScript(shellName string) string {
	switch shellName {
	case "bash", "zsh":
		return getBashZshInit()
	case "pwsh", "powershell":
		return getPowerShellInit()
	default:
		return ""
	}
}

// getEnvSetup returns environment variables needed for shell integration.
func getEnvSetup() []string {
	return []string{
		"TERM=xterm-256color",
	}
}

// FormatCommandEndMarker formats the command end marker with an exit code.
func FormatCommandEndMarker(exitCode int) string {
	return fmt.Sprintf(DefaultMarkers().CommandEnd, exitCode)
}

// createInitFile creates a temporary initialization file with the shell
// integration script. Returns the file path and a cleanup function.
func createInitFile(shellName, initScript string) (string, func(), error) {
	if initScript == "" {
		return "", nil, nil
	}

	var tempFile *os.File
	var err error

	switch shellName {
	case "bash":
		tempFile, err = os.CreateTemp("", "blockterm-bash-init-*.sh")
	case "zsh":
		tempFile, err = os.CreateTemp("", "blockterm-zsh-init-*.zsh")
	case "pwsh", "powershell":
		tempFile, err = os.CreateTemp("", "blockterm-ps-init-*.ps1")
	default:
		tempFile, err = os.CreateTemp("", "blockterm-shell-init-*.sh")
	}

	if err != nil {
		return "", nil, fmt.Errorf("failed to create temp init file: %w", err)
	}

	if _, err := tempFile.WriteString(initScript); err != nil {
		tempFile.Close()
		os.Remove(tempFile.Name())
		return "", nil, fmt.Errorf("failed to write init script: %w", err)
	}

	filePath := tempFile.Name()
	tempFile.Close()

	return filePath, func() { os.Remove(filePath) }, nil
}

// prepareShellCommand prepares the shell command with the BlockTerm
// initialization script injected. Returns the shell path, args, and a
// cleanup function (may be nil if no temp file was created).
//
// shellPath may be a full path (e.g. /bin/zsh); the shell name is derived
// via filepath.Base so comparisons always work.
func prepareShellCommand(shellPath string) (string, []string, func(), error) {
	shellName := filepath.Base(shellPath)
	initScript := getInitializationScript(shellName)
	if initScript == "" {
		return shellPath, nil, nil, nil
	}

	initFile, cleanup, err := createInitFile(shellName, initScript)
	if err != nil {
		return "", nil, nil, err
	}

	var args []string
	if initFile != "" {
		switch shellName {
		case "bash":
			// --rcfile replaces ~/.bashrc; our init sources ~/.bashrc itself.
			args = []string{"--rcfile", initFile}
		case "zsh":
			// Point ZDOTDIR at a temp dir whose .zshrc is our init file.
			// We rename the temp file to .zshrc inside a dedicated directory.
			zdotdir, zdotCleanup, zdotErr := createZshZdotdir(initFile)
			if zdotErr == nil && zdotdir != "" {
				// Wrap cleanup to remove both the init file and the zdotdir.
				origCleanup := cleanup
				cleanup = func() {
					origCleanup()
					zdotCleanup()
				}
				// Pass ZDOTDIR via env; args stay empty (zsh picks up .zshrc).
				args = []string{"-d", "-f", "--no-globalrcs",
					"-c", fmt.Sprintf("ZDOTDIR=%s exec zsh -i", zdotdir)}
				break
			}
			// Fallback: source init then exec interactive zsh.
			args = []string{"-c", fmt.Sprintf("source %s; exec zsh -i", initFile)}
		case "pwsh", "powershell":
			args = []string{"-NoProfile", "-Command",
				fmt.Sprintf(". '%s'; $host.EnterNestedPrompt()", initFile)}
		default:
			args = []string{"-c", fmt.Sprintf(". %s; exec %s -i", initFile, shellPath)}
		}
	}

	return shellPath, args, cleanup, nil
}

// createZshZdotdir creates a temporary directory to serve as ZDOTDIR for zsh.
// It places the provided initFile content as .zshrc inside that directory.
func createZshZdotdir(initFile string) (string, func(), error) {
	dir, err := os.MkdirTemp("", "blockterm-zdotdir-*")
	if err != nil {
		return "", nil, fmt.Errorf("failed to create zdotdir: %w", err)
	}

	// Read existing init script
	content, err := os.ReadFile(initFile)
	if err != nil {
		os.RemoveAll(dir)
		return "", nil, fmt.Errorf("failed to read init file: %w", err)
	}

	if err := os.WriteFile(filepath.Join(dir, ".zshrc"), content, 0o600); err != nil {
		os.RemoveAll(dir)
		return "", nil, fmt.Errorf("failed to write .zshrc: %w", err)
	}

	return dir, func() { os.RemoveAll(dir) }, nil
}
