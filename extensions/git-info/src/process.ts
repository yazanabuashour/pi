import { Cause, Context, Data, Effect, Layer, Match, Stream } from "effect";
import type * as PlatformError from "effect/PlatformError";
import { ChildProcess } from "effect/process";
import { ChildProcessSpawner } from "effect/process/ChildProcessSpawner";

const MAX_STREAM_CHARS = 10 * 1_024 * 1_024;

const TRUNCATED_MARKER = "\n[command output truncated]\n";

function appendBounded(current: string, chunk: string) {
  if (current.endsWith(TRUNCATED_MARKER)) return current;

  if (current.length + chunk.length <= MAX_STREAM_CHARS) return current + chunk;
  const remaining = Math.max(0, MAX_STREAM_CHARS - current.length);

  return `${current}${chunk.slice(0, remaining)}${TRUNCATED_MARKER}`;
}

export interface CommandResult {
  code: number;
  stderr: string;
  stdout: string;
}

export class CommandError extends Data.TaggedError("CommandError")<{
  readonly command: string;
  readonly args: ReadonlyArray<string>;
  readonly cwd: string;
  readonly stdout: string;
  readonly stderr: string;
  readonly cause: PlatformError.PlatformError | Cause.TimeoutError;
}> {
  override get message() {
    return Match.value(this.cause).pipe(
      Match.tag("TimeoutError", () => "timed out"),
      Match.tag("PlatformError", ({ reason }) =>
        Match.value(reason).pipe(
          Match.when(
            { module: "ChildProcess", method: "exitCode" },
            () => "terminated",
          ),
          Match.tag(
            "NotFound",
            () => "command or working directory not found (NotFound)",
          ),
          Match.tag("BadArgument", () => "invalid command arguments"),
          Match.orElse((error) => `system error (${error._tag})`),
        ),
      ),
      Match.exhaustive,
    );
  }
}

interface CommandRunnerService {
  run(
    command: string,
    args: string[],
    cwd: string,
    timeout: number,
  ): Effect.Effect<CommandResult, CommandError>;
}

export class CommandRunner extends Context.Service<
  CommandRunner,
  CommandRunnerService
>()("git-info/CommandRunner") {}

export const CommandRunnerLive = Layer.effect(
  CommandRunner,
  Effect.gen(function* () {
    const spawner = yield* ChildProcessSpawner;

    return CommandRunner.of({
      run: (command, args, cwd, timeout) =>
        Effect.suspend(() => {
          let stderr = "";
          let stdout = "";

          const child = ChildProcess.make(command, args, {
            cwd,
            detached: false,
            forceKillAfter: "5 seconds",
            stdin: "ignore",
            stderr: "pipe",
            stdout: "pipe",
          });

          return Effect.scoped(
            Effect.gen(function* () {
              const handle = yield* spawner.spawn(child);

              const [, , code] = yield* Effect.all(
                [
                  Stream.runForEach(Stream.decodeText(handle.stdout), (chunk) =>
                    Effect.sync(() => {
                      stdout = appendBounded(stdout, chunk);
                    }),
                  ),
                  Stream.runForEach(Stream.decodeText(handle.stderr), (chunk) =>
                    Effect.sync(() => {
                      stderr = appendBounded(stderr, chunk);
                    }),
                  ),
                  handle.exitCode,
                ],
                { concurrency: "unbounded" },
              );

              return { code: Number(code), stderr, stdout };
            }),
          ).pipe(
            Effect.timeout(timeout),
            Effect.mapError(
              (cause) =>
                new CommandError({
                  command,
                  args: [...args],
                  cwd,
                  stderr,
                  stdout,
                  cause,
                }),
            ),
          );
        }),
    });
  }),
);

export const runCommand = (
  command: string,
  args: string[],
  cwd: string,
  timeout: number,
) =>
  Effect.gen(function* () {
    const commands = yield* CommandRunner;

    return yield* commands.run(command, args, cwd, timeout);
  });
