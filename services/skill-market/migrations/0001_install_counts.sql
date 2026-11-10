-- 只记录每个 Skill 的安装次数，不含任何 IP、设备或使用者信息。
CREATE TABLE IF NOT EXISTS install_counts (
  skill_id TEXT PRIMARY KEY NOT NULL,
  count INTEGER NOT NULL DEFAULT 0
);
