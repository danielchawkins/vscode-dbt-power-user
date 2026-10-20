# Draft: `uv_fs_copyfile` spins forever when the source shrinks during the copy (Linux)

Not filed. Target: [libuv/libuv](https://github.com/libuv/libuv/issues), with a cross-reference on microsoft/vscode, whose local history triggers it.

## Summary

On Linux, `uv_fs_copyfile` reads the source's size once, then loops calling `uv_fs_sendfile` until it has copied that many bytes. If the source is truncated during the copy, the kernel returns 0 at end of file, and the loop keeps calling with the same offset and length. It never exits, and one thread-pool thread spins at 100% CPU.

## Where it happens

`src/unix/fs.c`, `uv__fs_copyfile` (v1.x):

```c
bytes_to_send = src_statsbuf.st_size;
in_offset = 0;
while (bytes_to_send != 0) {
  ...
  bytes_written = uv_fs_sendfile(NULL, &fs_req, dstfd, srcfd, in_offset, bytes_chunk, NULL);
  ...
  if (bytes_written < 0) {
    err = bytes_written;
    break;
  }
  bytes_to_send -= bytes_written;
  in_offset += bytes_written;
}
```

A return of 0 is neither an error nor progress, so `bytes_to_send` never reaches 0. On Linux, `uv__fs_sendfile` goes through `copy_file_range`, which returns 0 at end of file.

## Observed

VS Code 1.141.0, linux-arm64, in a Debian 12 container on overlayfs (Colima). The main process stayed at about 98% CPU after its extension host exited, so the window never closed. `strace` on the spinning `libuv-worker` thread:

```text
copy_file_range(113, [102], 116, NULL, 88, 0) = 0
copy_file_range(113, [102], 116, NULL, 88, 0) = 0
...
```

That is 17,500 identical calls in 3 seconds, for over an hour. fd 113 was a 102-byte `dbt_project.yml`, already deleted. fd 116 was VS Code's local-history copy, at `User/History/<id>/<file>.yml`, also 102 bytes. The source had been 190 bytes when the copy started, and a test rewrote it to 102 bytes.

## Reproduction (sketch)

1. Create a file of N bytes.
2. Start `uv_fs_copyfile` on it.
3. While the copy is in flight, truncate the source below N.

The window is small, so a large source or a slow destination makes it easier to hit.

## Suggested fix

Treat a 0 return before `bytes_to_send` reaches 0 as the end of the source: stop the loop. Then either succeed with the shorter copy, or fail with an error such as `UV_EIO`.

## Workaround

In this repository's integration tests, VS Code test windows run with `"workbench.localHistory.enabled": false`. That stops local history from copying files the tests rewrite.
