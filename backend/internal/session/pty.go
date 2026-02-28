package session

import (
	"os"
	"os/exec"
	"os/user"
	"runtime"
)

// defaultShell returns the default shell for the current OS.
func defaultShell() string {
	switch runtime.GOOS {
	case "windows":
		// Try PowerShell first, fallback to cmd
		if ps, err := exec.LookPath("pwsh"); err == nil {
			return ps
		}
		if ps, err := exec.LookPath("powershell"); err == nil {
			return ps
		}
		return "cmd.exe"
	case "darwin", "linux":
		// Check user's shell from environment
		if shell := os.Getenv("SHELL"); shell != "" {
			return shell
		}
		// Try common shells in order
		shells := []string{"zsh", "bash", "sh"}
		for _, shell := range shells {
			if path, err := exec.LookPath(shell); err == nil {
				return path
			}
		}
		return "/bin/sh" // fallback
	default:
		return "/bin/sh"
	}
}

// homeDir returns the user's home directory.
func homeDir() string {
	if home := os.Getenv("HOME"); home != "" {
		return home
	}
	if home := os.Getenv("USERPROFILE"); home != "" {
		return home
	}
	if usr, err := user.Current(); err == nil {
		return usr.HomeDir
	}
	return "."
}
