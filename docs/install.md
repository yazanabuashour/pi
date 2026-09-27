# Install the Pi package

Use your platform's Pi installation, Node 24 or newer, npm, Git, and tar.

## Install and register

```bash
git clone https://github.com/yazanabuashour/pi.git
cd pi
npm run install:local
pi install "$HOME/.local/share/dotfiles-pi-package/current/node_modules/yazan-pi-setup" --no-approve
```

Register the package root shown above, not an individual resource directory;
Pi resolves production dependencies from that root.
Start a new session and check for startup errors. Existing sessions retain their
loaded extensions. Use `/login` to authenticate and `/model` to select a model;
Ctrl+S in the picker saves the startup model.

## Update

After [validation and required review](development.md), run `npm run install:local`
and start a new session. Updates leave settings unchanged. Keep installation
directories while processes use them. See [delivery behavior](architecture.md).

## Add browser and web tools

```bash
pi install npm:agent-browser --no-approve
pi install npm:pi-web-access --no-approve
```

In `~/.pi/agent/settings.json`, replace the browser entry in `packages` with this
skill-only entry. Preserve other entries and filters:

```json
{
  "source": "npm:agent-browser",
  "extensions": [],
  "skills": ["skills/agent-browser/SKILL.md"],
  "prompts": [],
  "themes": []
}
```

Follow the installed browser skill for setup; `agent-browser skills get core`
loads its guide. Configure an approved search service in the web extension's
settings and verify page answers with your chosen provider. Search authentication
is separate from coding-provider login.
