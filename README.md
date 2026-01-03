# BlockTerm

A modern terminal that organizes your work into command blocks, remembers everything you've done, and helps you work faster with intelligent suggestions.

## Features

**📦 Command Blocks**  
Every command and its output are automatically grouped into collapsible blocks. Navigate your terminal history visually, copy entire command outputs with one click, and keep your workspace organized.

**🔮 Smart Autocomplete**  
Get intelligent suggestions as you type from your command history, filesystem, and common commands. The terminal learns from your workflow and suggests what you need, when you need it.

**🕐 Never Lose History**  
All your commands are permanently saved with full context: what you ran, when you ran it, where you were, and whether it succeeded. Search through weeks or months of history instantly.

**📑 Tabs & Split Panes**  
Work on multiple projects simultaneously with tabs and split your terminal into panes. Each pane runs independently, so you can monitor logs while running commands.

**⚡ Fast & Reliable**  
Handles large outputs without lag, works perfectly with vim, ssh, and other interactive applications. Your sessions survive crashes—what you're doing is never lost.

**🔒 Private & Offline**  
Everything runs locally on your machine. No data leaves your computer unless you explicitly enable optional sync features.

## Installation

### Download

Coming soon: pre-built binaries for macOS, Linux, and Windows.

### Build from Source

**Requirements:** Node.js 18+, Go 1.21+

```bash
# Clone the repository
git clone https://github.com/yourusername/BlockTerm.git
cd BlockTerm

# Install dependencies and build
npm install
npm run build

# Launch BlockTerm
npm start
```

## Quick Start

1. **Launch BlockTerm** – Your default shell starts automatically
2. **Run commands** – Each command creates a new block
3. **Press ↑/↓** – Browse your command history
4. **Start typing** – Get suggestions from history and filesystem
5. **Use Ctrl+Space** – Open full suggestion menu
6. **Ctrl+F** – Search through terminal output

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Ctrl/Cmd + T` | New tab |
| `Ctrl/Cmd + W` | Close tab |
| `Ctrl/Cmd + D` | Split pane |
| `Ctrl/Cmd + F` | Search |
| `Ctrl + Space` | Open suggestions |
| `↑` / `↓` | Navigate history |
| `Tab` | Complete suggestion |

## Privacy & Security

- All data stays on your device
- No network connections required
- No telemetry or tracking
- Optional sync feature is opt-in only

## Roadmap

- [ ] Terminal sessions with block grouping
- [ ] Command suggestions
- [ ] Persistent history search
- [ ] Tabs and split panes
- [ ] Block sharing and export
- [ ] Workspace save/restore
- [ ] Optional cloud sync
- [ ] AI-powered suggestions

## Support

- 📖 [Documentation](docs/)
- 🐛 [Report Issues](https://github.com/entl/BlockTerm/issues)
- 💬 [Discussions](https://github.com/entl/BlockTerm/discussions)

## Contributing

We welcome contributions! Please see [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

## License

[Apache License 2.0](LICENSE) © 2026 Maksym Vorobyov
