# Renderer benchmark

Dispatch `renderer-benchmark.yml` to compare Mesa worker counts and vector widths on one Ubuntu runner. No mods are installed. `generated-world.zip` contains a world created by Codex for testing, not a player's save or credentials. Its built-in test datapack repeats camera movement; it is never installed in normal player sessions.

Each case restores identical terrain, uses 960×540 low graphics with a 60 FPS game cap, warms up for 30 seconds and records 30 seconds of individual frame times through MangoHud. The initial screening run used a longer 50-second warmup and 40-second recording. A lower-priority FFmpeg H.264 encoder provides representative background CPU load; it is not a full measurement of the production Selkies stream. The default is repeated at the end to detect drift. The confirmation suite measures default/candidate/candidate/default. Captures must show the game world, and results need at least 200 frame samples before they are accepted.

Compare median and tail frame times, not just average FPS. Repeat promising configurations on another loader and runner before choosing a default. The benchmark produces private-account GitHub artifacts retained for seven days and never uploads logs to a third-party benchmark service.
