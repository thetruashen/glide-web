# Backend performance ideas — no new changes applied

Automatic performance-mod installation has been removed. The mod catalog and player-installed files remain available. Existing Java, render-cap, stream-priority and snapshot settings remain unchanged. The following are proposals only, with no automatic mod additions.

Previous live testing identified LLVMpipe CPU rendering on a four-core runner. This is evidence about that runner, not a controlled benchmark across all packs. Separate frame time, chunk generation, simulation, garbage collection and background work before choosing changes.

1. **GPU-backed rendering and encoding.** The strongest hardware option to investigate: move OpenGL rendering off the CPU and use a hardware encoder where available. Requires a suitable runner/host, potentially paid infrastructure; copying repositories cannot create GPU hardware. Measure frame-time spikes as well as average FPS.
2. **Benchmark Mesa and CPU scheduling.** Compare LLVMpipe worker counts and documented native-vector widths on the actual runner. The game, software renderer and encoder share limited CPU. Measure movement through existing chunks separately from new terrain; avoid blind global thread pinning or unsupported driver flags.
3. **Incremental live backups.** Track changes so unchanged multi-gigabyte mods are not read and packed every backup. Keep atomic save capture, checksums and complete recoverable browser backups. This may reduce gameplay interruptions if they coincide with snapshots; it needs measurements first.
4. **Tune heap and GC from evidence.** Record GC pauses, memory pressure and frame times using supported Java versions for each loader. Leave RAM for Mesa, the encoder and OS. More heap or a large flag bundle does not automatically improve gameplay. Do not change pack-provided Java constraints.
5. **Reduce unnecessary background processes.** Profile the desktop, launcher, audio, session API and stream worker. Consider suspending idle UI work only after confirming safe shutdown and session recovery. Evaluate separate CPU budgets for the game and encoding.
6. **Predictable runner resources.** A persistent host with a faster CPU and adequate RAM may reduce chunk-generation and simulation stalls. Compare single-thread performance and resource contention. Extra runner accounts increase concurrent capacity, not one game's CPU speed.
7. **Preinstalled runtime image and immutable caches.** Bundle Java versions, desktop/audio/stream dependencies and launcher tools; cache exact game/loader installations. This targets startup time, not sustained gameplay FPS. Never include private saves or account data. A downloaded container image also has transfer cost.

Suggested order: measure frame-time spikes and backup overlap, benchmark renderer scheduling, then evaluate hardware. Keep preinstalled runtimes as a separate startup improvement.

Sources:

- Current implementation: `.github/workflows/glide-session.yml`, `Client/scripts/session_api.py`.
- [Mesa LLVMpipe renderer, vector-width controls and profiling](https://docs.mesa3d.org/drivers/llvmpipe.html)
- [Oracle Java GC tuning guidance](https://docs.oracle.com/en/java/javase/21/gctuning/introduction-garbage-collection-tuning.html)
