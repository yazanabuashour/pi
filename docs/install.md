# Install the Pi package

Use your platform's Pi installation and Node 24 or newer.

## Install the package

Clone the repository and install its checked resources:

```bash
git clone https://github.com/yazanabuashour/pi.git
cd pi
npm run install:local
pi install "$HOME/.local/share/dotfiles-pi-package/current/node_modules/yazan-pi-setup" --no-approve
```

Register the full `current/node_modules/yazan-pi-setup` path, not a leaf-directory
alias. Pi needs that path to resolve sibling production dependencies.

Start a new Pi session. Check for startup errors and confirm your model with
`/model`. Existing sessions keep their loaded extensions.

## Update the package

After the required checks and review, run `npm run install:local`.
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
object to load its upstream discovery skill. Preserve other entries and filters:

```json
{
  "source": "npm:agent-browser",
  "extensions": [],
  "skills": ["skills/agent-browser/SKILL.md"],
  "prompts": [],
  "themes": []
}
```

Follow the installed browser skill and `agent-browser skills get core` for browser
setup. Configure an approved search service in the web extension's settings.
Copilot login does not provide Codex-backed OpenAI search.

Use `/login` to authenticate with your coding provider. Use `/model` to select a
model. In the model picker, press Ctrl+S to save the startup model. Verify that
page answers work with the chosen provider.
