# Backend performance ideas — proposals only

No backend optimizations were applied with this UI update.

1. **Measure each stage first.** Separate runner queue time, cache restore, apt installation, loader preparation, instance transfer, Minecraft startup and world entry. Compare cold and warm launches. Measure game frame time, simulation tick time, memory and encoder CPU separately.
2. **Prepackage the runtime.** Evaluate a tested image with desktop, audio, streaming and launcher dependencies already installed. The current workflow installs these through apt on each fresh runner. Validate container display/audio permissions before changing the deployment.
3. **Improve immutable caches.** Cache exact loader/runtime installations using game version, loader version, Java, architecture and installer inputs. Keep website-only changes out of those cache keys. Measure transfer costs and prioritize popular configurations. Never cache private worlds or account data.
4. **Benchmark streaming CPU use.** Compare the current 60 FPS software H.264 stream with 30 FPS and lower resolutions. Match the game frame cap to the stream target. This may free CPU for rendering and simulation, at the cost of motion clarity.
5. **Evaluate GPU rendering and hardware encoding.** Xvfb/Mesa in the current workflow suggests CPU rendering may be a bottleneck; confirm the actual OpenGL renderer first. A GPU-backed host could address rendering and encoding together, but needs available hardware and possibly paid hosting. Extra repositories do not give each runner a GPU.
6. **Test optional performance mods per loader/version.** ModernFix targets load time and memory; Lithium targets simulation; Sodium targets rendering on Fabric/NeoForge. Verify exact releases, pack compatibility and Mesa support. Preserve pack pins and avoid duplicates. ModernFix dynamic resources needs separate compatibility testing. Do not promise a universal speedup or inject these into every pack.
7. **Tune memory from measurements.** Test supported Java versions and heap sizes with GC logs. Leave memory for the operating system, Mesa and encoder. More heap is not automatically faster; avoid generic flag bundles.
8. **Reduce repeated instance transfer work.** Explore content-addressed immutable mod files plus changed-save transfers, while retaining complete recoverable snapshots and hash checks. Avoid repacking unchanged large mods. Shared caches must exclude private saves and credentials.

Start with timing, runtime packaging and encoder benchmarks, then evaluate pack-specific changes. These are hypotheses, not measured speedup claims.

Sources:

- Current implementation: `.github/workflows/glide-session.yml`.
- [Mesa LLVMpipe software renderer](https://docs.mesa3d.org/drivers/llvmpipe.html)
- [Sodium](https://github.com/CaffeineMC/sodium)
- [Lithium](https://github.com/CaffeineMC/lithium)
- [ModernFix](https://github.com/embeddedt/ModernFix)
