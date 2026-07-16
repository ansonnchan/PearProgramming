# PearProgramming Agent Instructions

## Project overview

PearProgramming is a real-time collaborative coding environment.

Core systems include:

- React and TypeScript frontend
- Monaco editor
- Yjs collaborative document synchronization
- Spring Boot backend
- WebSocket communication
- Redis Pub/Sub
- shared workspaces, files, chat, presence, and code execution

Preserve real-time collaboration behaviour when modifying frontend components.

## Working conventions

- Inspect existing components before creating replacements.
- Reuse current hooks and services where possible.
- Do not replace working functionality with mock data or placeholders.
- Do not perform broad rewrites unless explicitly approved.
- Keep components reasonably sized.
- Extract shared behaviour when it improves clarity, but avoid unnecessary abstraction.
- Preserve strict TypeScript types.
- Avoid `any` unless there is a documented reason.
- Keep accessibility and keyboard interaction in mind.

## UI direction

PearProgramming should feel like a cozy shared coding room.

The visual language should use:

- warm cream surfaces
- muted pear green accents
- dark charcoal editor surfaces
- rounded corners
- soft borders and shadows
- small pear-themed illustrations
- subtle paper-like warmth
- restrained animation

The interface should remain professional and functional.

Avoid:

- generic SaaS styling
- excessive gradients
- neon colours
- overly cartoonish elements
- decorative elements covering functional content
- fragile absolute positioning for main layout
- excessive animation

## Layout

- Use CSS Grid or Flexbox for major layout regions.
- Avoid overlapping panels.
- Panels should manage their own overflow.
- Monaco containers require valid minimum heights.
- Sidebars should be collapsible on smaller screens.
- Test at typical laptop and desktop widths.

## Testing

Before completing a phase, run the repository’s relevant:

- frontend tests
- backend tests when affected
- type checking
- linting
- production build

Add tests for keyboard-heavy interactive components.

## Git

Make reasonably sized commits.

Use normal commit messages such as:

- redesigned workspace layout
- improved room chat interactions
- added mention menu keyboard support

Do not use conventional commit prefixes such as `feat:` or `fix:`.
Do not use phase-number commit messages.

Stop after each requested implementation phase and summarize:

- files changed
- behaviour changed
- tests run
- known concerns