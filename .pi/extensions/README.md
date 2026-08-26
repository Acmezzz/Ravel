# Pi 扩展

本目录是 Ravel 的通用扩展根目录。启动时通过 `extensionsRoot`（可用
`RAVEL_EXTENSIONS_ROOT` 覆盖）加载这里的扩展、skill 和 prompt 模板。

历史上的 `journal-workflow/` 与 `exploration-scout/` 内置插件已在切片 0
（2026-08-26）删除；它们在用户磁盘上留下的
`~/.pi/agent/{journals,workflows,journal-backups,explorations}` 数据仅作
备份保留，产品不再读取。
