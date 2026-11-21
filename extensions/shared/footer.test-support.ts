import {
  SessionManager,
  type ExtensionUIContext,
} from "@earendil-works/pi-coding-agent";

type FooterFactory = Parameters<ExtensionUIContext["setFooter"]>[0];

type FooterArgs = Parameters<NonNullable<FooterFactory>>;

export function footerFixtureArgs(): FooterArgs {
  return [
    // SAFETY: The footer only calls requestRender on the TUI.
    { requestRender() {} } as FooterArgs[0],
    // SAFETY: The footer only calls fg on the theme.
    { fg: (_color, text) => text } as FooterArgs[1],
    {
      getExtensionStatuses: () => new Map(),
      getGitBranch: () => null,
      getAvailableProviderCount: () => 0,
      onBranchChange: () => () => {},
    },
  ];
}

export function sessionWithCost(cwd: string, total: number) {
  const session = SessionManager.inMemory(cwd);
  session.appendMessage({
    role: "assistant",
    content: [],
    api: "openai-completions",
    provider: "openai",
    model: "fixture",
    stopReason: "stop",
    timestamp: 0,
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total },
    },
  });

  return session;
}
