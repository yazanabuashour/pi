# Install the Pi package

Use your platform's Pi installation, Node 24 or newer, npm, Git, and tar.

## Install and register

```bash
git clone https://github.com/yazanabuashour/pi.git
cd pi
npm run install:local
pi install "$HOME/.local/share/dotfiles-pi-package/current/node_modules/yazan-pi-setup" --no-approve
```

Register the package root, not a resource directory, so Pi can resolve its
dependencies. Start a new session and check for startup errors; existing sessions
keep their loaded extensions. Use `/login` to authenticate and `/model` to select
a model; Ctrl+S in the picker saves the startup model.

## Update

After [validation and required review](development.md), run `npm run install:local`
and start a new session. Updates leave settings unchanged. Keep installation
directories while processes use them. See [delivery behavior](architecture.md).

## Add browser and web tools

```bash
pi install npm:agent-browser --no-approve
pi install npm:pi-web-access --no-approve
```

In `~/.pi/agent/settings.json`, use this browser entry in `packages`. For an
existing entry, keep its `source` and version pin. Leave other entries unchanged:

```json
{
  "source": "npm:agent-browser",
  "extensions": [],
  "skills": ["skills/agent-browser/SKILL.md"],
  "prompts": [],
  "themes": []
}
```

If you use `~/.agents/skills/agent-browser/SKILL.md`, Pi discovers it automatically.
Avoid loading a duplicate: set only `"skills": []` on the browser package entry,
keeping its `source` and other filters. Convert a string entry to an object with
that same `source` and `"skills": []`. The shared skill is optional.

Follow your browser skill for setup. `agent-browser skills get core` loads the
upstream guide. Configure an approved search service in the web extension's
settings; search authentication is separate from coding-provider login.
Verify page answers with your chosen provider.
