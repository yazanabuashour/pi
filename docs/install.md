# Install the Pi package

Use your platform's Pi installation, Node 24 or newer, npm, Git, and tar.

## Install the package

Clone the repository, install the package, and register it with Pi:

```bash
git clone https://github.com/yazanabuashour/pi.git
cd pi
npm run install:local
pi install "$HOME/.local/share/dotfiles-pi-package/current/node_modules/yazan-pi-setup" --no-approve
```

Register the full `current/node_modules/yazan-pi-setup` path, not an alias for an
individual resource directory. Pi needs the package root to resolve its
production dependencies.

Start a new Pi session. Check for startup errors. Confirm your model with `/model`.
Existing sessions keep their loaded extensions.

## Update the package

After the [required checks and review](development.md), run `npm run install:local`.
Start a new session to load the update. Package updates leave your settings alone.
Keep installation directories while running processes use them.

See [Package ownership and delivery](architecture.md) for installation behavior.

## Add browser and web tools

Install the upstream packages through Pi:

```bash
pi install npm:agent-browser --no-approve
pi install npm:pi-web-access --no-approve
```

In `~/.pi/agent/settings.json`, replace the browser entry in `packages` with this
object to load its discovery skill. Preserve other entries and filters:

```json
{
  "source": "npm:agent-browser",
  "extensions": [],
  "skills": ["skills/agent-browser/SKILL.md"],
  "prompts": [],
  "themes": []
}
```

Follow the installed browser skill for setup. Run `agent-browser skills get core`
to read the browser guide.

Configure an approved search service in the web extension's settings. Search is
separate from your coding provider; Copilot login does not provide Codex-backed
OpenAI search.

To set up your coding model and check page answers:

1. Use `/login` to authenticate with your coding provider.
2. Use `/model` to select a model.
3. In the model picker, press Ctrl+S to save the startup model.
4. Verify that page answers work with the chosen provider.
