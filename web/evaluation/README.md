# Recognition evaluation

Run `npm run dev` to access the local **Recognition diagnostics** panel. It is absent from `npm run build` and `npm run preview`. Start capture, make one attempt, stop capture, and download the JSON. Each capture is limited to 900 processed frames. Store it outside Git unless participants have explicitly agreed to share their landmark recordings. The file contains timestamped hand landmarks, pose transitions, raw and filtered fingertip paths, and cast evaluations; it contains no camera video.

Create a manifest next to the captures:

```json
{
  "cases": [
    { "file": "person-a-circle.json", "person": "person-a", "split": "train", "scenario": "circle / right hand / 16:9", "expected": "circle" },
    { "file": "person-b-idle.json", "person": "person-b", "split": "test", "scenario": "ordinary movement", "expected": null }
  ]
}
```

`expected` is `triangle`, `circle`, `zigzag`, or `null` for an unsupported drawing or ordinary movement. Label the attempt from what the participant was asked to draw, before inspecting recognition output. Use one capture per attempt. Keep every person's recordings entirely in `train` or `test`; the evaluation script rejects a person in both splits.

From `web/`, run `npm run evaluate -- path/to/capture.json` to inspect one capture. This reports each stored cast beside its result when replayed through the current code, with candidate diagnostics. A single capture has no ground-truth labels, so it cannot measure accuracy.

Run `npm run evaluate -- path/to/manifest.json` for a labeled batch. It replays captured landmarks through the current pose detector, recorder, and shape evaluator. It prints each case and overall accuracy, valid shape recall, and false cast rate for each split, plus accuracy by scenario. Record a baseline before changing thresholds, tune on `train`, and use `test` only to check the final choice. The space after `--` is required in both commands.

Collect examples across people, left and right hands, drawing sizes and speeds, camera aspect ratios, unsupported shapes, and ordinary movement. Check failures in the diagnostics panel. A downloaded capture with no completed cast is still useful: it can expose pose or release failures that a classifier test cannot see.
