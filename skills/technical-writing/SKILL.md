---
name: technical-writing
description: "Apply Diátaxis structure, Google developer style, STE instruction rules, and Global English syntax to docs, RFCs, READMEs, PR descriptions, and commit messages."
disable-model-invocation: true
---

# Write clear technical documentation

Write for a tired engineer who needs to understand the text on the first read.
Cut words that add no meaning. Prefer everyday words: "use", not "utilize".
If a rule makes a sentence worse, rewrite the sentence another way or leave it alone.

Use the codebase's names for symbols, files, flags, and commands. Do not invent
jargon or rename a concept to vary the prose. Define named patterns on first use.

## Pick one document mode

Choose the mode by the reader's goal. Keep each document in one mode and link to
other modes when needed.

- **Tutorial — learn by doing.** Open with what the learner builds. Write as
  "we", in commands. Make each step produce a visible result and say what to
  expect. Keep explanations to one clause and a link.
- **How-to — complete a task.** Assume competence. Give actions, conditions,
  and choices, not background or teaching. Name the guide after the task:
  "Calibrate the radar array".
- **Reference — look up facts.** Describe options, limits, and errors without
  instruction, persuasion, or opinion. Follow the structure of the code.
  Generate reference material from code where possible.
- **Explanation — understand why.** Cover one bounded topic. Explain the
  context, decisions, constraints, and alternatives. Distinguish facts from
  judgments and give reasons for recommendations.

Source: [Diátaxis](https://diataxis.fr/), fetched 2026-07-18.

## Address the reader directly

- Use "you" and the present tense. Reserve "will" for future events.
- Name the actor: "the compiler checks", not "is checked". Use passive voice
  when the actor is unknown or irrelevant.
- Write instructions as commands: "Click Submit", not "Submit should be clicked".
- Put conditions before actions and warnings before the steps they guard.
  Give the common case first, then exceptions.
- Use a conversational tone without buzzwords, metaphors, or promises of future
  support. Omit "please", "simply", "easy", and "quickly" from procedures.
- Make link text name the destination, not "click here". Include enough context
  that the reader knows why to follow the link.
- Use sentence case for headings. Start task headings with a verb; name the
  concept in other headings. Use one h1 per page and do not skip heading levels.
- Number sequences; use bullets for other lists. Introduce lists with a complete
  sentence and keep items parallel.
- Use code font for code and bold for UI elements. Use serial commas. For a
  partial list, say that it gives examples rather than ending with "etc."

Source: [Google developer style](https://developers.google.com/style), fetched 2026-07-18.

## Keep each sentence focused

- Give one instruction or thought per sentence. Split sentences that hide an
  action or condition, but keep a long sentence when it carries one clear thought.
- Mix sentence lengths. Do not start consecutive sentences with the same phrase.
- Be specific: "a column rename fails the build", not "schema changes can cause issues".
- Give each word one meaning and each action one name. Use "start" consistently
  rather than alternating between "start" and "initiate".
- Keep articles: "Remove the backup file", not "Remove backup file".
- Avoid ambiguous "-ing" constructions. Read awkward sentences aloud and rewrite
  them if they still sound awkward.

Source: [Simplified Technical English](https://asd-ste100.org/), Issue 9, 2025;
principles fetched 2026-07-18. The numbered rules and dictionary are in the specification.

## Remove ambiguity

- Put "only" and "not" next to the words they modify. "Only fails on growth"
  and "fails only on growth" mean different things.
- Break up long noun strings: "the script that checks proto imports", not
  "the proto import check script".
- Give every pronoun one clear referent. Repeat the noun when needed. Do not
  use "this" or "which" to refer vaguely to a whole clause.
- Keep verbs and small words that clarify structure: "Phase 1 moves the converters
  and Phase 2 moves the runtime"; "Ensure that the switch is off".
- Repeat articles when they distinguish things: "the client and the host".
- Clarify what "and" or "or" joins. Use "both…and", "either…or", or "if…then"
  when needed. Replace slashes with "or" or "a, b, or both".
- Make parenthetical text a complete grammatical unit, or give it its own
  sentence. Do not form plurals with "(s)".
- Avoid idioms, colloquialisms, and Latin abbreviations. Keep terminology
  consistent across documents and avoid rewording already-clear text.

Source: John R. Kohl, *The Global English Style Guide* (SAS Press);
guidelines fetched from the Internet Archive and SAS sample chapter, 2026-07-18.

## Check the result

Apply these checks to documentation, PR descriptions, and commit messages.
The document-mode check applies to documentation sets, not commit messages.
For product UI text, follow the product's copy guidelines instead.

1. Does each document serve one mode and link to other modes where needed?
2. Are instructions commands, with conditions and warnings before their actions?
3. Does each sentence carry one clear thought or instruction?
4. Can you cut any word without losing meaning?
5. Are modifiers, pronouns, and clauses unambiguous?
6. Does each concept have one name throughout the docs?
7. Would a developer say these words aloud?
8. Do symbols, paths, commands, links, and behavior match the implementation?
   For counts and tree claims, include the command that regenerates them.
9. Do code examples follow repository and language formatting conventions?
