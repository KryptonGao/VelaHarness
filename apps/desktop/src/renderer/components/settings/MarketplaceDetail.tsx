import {
  marketplaceDeveloper,
  marketplaceHomepage,
  marketplaceSkillCommand,
  type MarketplaceSkillEntry,
  type SkillCatalog,
} from "@vela/shared";
import { useEffect } from "react";
import { showToast } from "../../toast";
import type { SettingsCopy } from "../settings-copy";
import { MarketplaceIcon } from "./MarketplaceIcon";
import { Icon } from "../icons";

type SkillItem = SkillCatalog["skills"][number];

export interface MarketplaceActionProps {
  copy: SettingsCopy["agent"];
  entry: MarketplaceSkillEntry;
  /** 已经装在 Vela 里的同名 Skill；没有就是还没安装。 */
  skill: SkillItem | undefined;
  busy: boolean;
  installing: string | null;
  confirmingUninstall: string | null;
  onInstall: (entry: MarketplaceSkillEntry) => void;
  onUninstall: (skill: SkillItem) => void;
}

/** 卡片和详情页共用的右侧操作：安装、卸载（两步确认）或只读的“已安装”。 */
export function MarketplaceAction({ copy, entry, skill, busy, installing, confirmingUninstall, onInstall, onUninstall }: MarketplaceActionProps) {
  const name = copy.skillsMarketNames[entry.id] ?? entry.skill;
  if (skill?.canDelete) {
    const confirming = confirmingUninstall === skill.name;
    return (
      <button
        type="button"
        className={`settings-secondary market-install${confirming ? " confirm" : ""}`}
        disabled={busy}
        aria-label={`${copy.skillsMarketUninstall} ${name}`}
        onClick={() => onUninstall(skill)}
      >
        {confirming ? copy.skillsMarketUninstallConfirm : copy.skillsMarketUninstall}
      </button>
    );
  }
  if (skill) {
    return (
      <span className="market-installed">
        <Icon name="check" size={14} />
        {copy.skillsMarketInstalled}
      </span>
    );
  }
  return (
    <button
      type="button"
      className="settings-secondary market-install"
      disabled={busy}
      title={marketplaceSkillCommand(entry)}
      aria-label={`${copy.skillsMarketInstall} ${name}`}
      onClick={() => onInstall(entry)}
    >
      {installing === entry.id ? copy.skillsMarketInstalling : copy.skillsMarketInstall}
    </button>
  );
}

export function MarketplaceDetail({
  copy,
  entry,
  installs,
  onBack,
  ...action
}: MarketplaceActionProps & { installs: number | null; onBack: () => void }) {
  const name = copy.skillsMarketNames[entry.id] ?? entry.skill;
  const description = copy.skillsMarketDescriptions[entry.id] ?? entry.description ?? "";
  const command = marketplaceSkillCommand(entry);
  const homepage = marketplaceHomepage(entry);

  useEffect(() => {
    function onKey(event: KeyboardEvent): void {
      if (event.key === "Escape") onBack();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onBack]);

  async function copyCommand(): Promise<void> {
    try {
      await navigator.clipboard.writeText(command);
      showToast(copy.skillCopied);
    } catch {
      // 剪贴板不可用时命令仍可手动选中复制。
    }
  }

  return (
    <div className="market-detail">
      <button type="button" className="market-back" onClick={onBack}>
        <Icon name="arrow-left" size={14} />
        {copy.skillsTabMarket}
      </button>
      <header className="market-detail-head">
        <MarketplaceIcon entry={entry} />
        <h2>{name}</h2>
        <MarketplaceAction copy={copy} entry={entry} {...action} />
      </header>
      <section>
        <h3 className="skills-group-head">{copy.skillsMarketDetailIntro}</h3>
        <p className="skill-detail-text">{description}</p>
      </section>
      {entry.mcp && entry.mcp.length > 0 ? (
        <section>
          <h3 className="skills-group-head">{copy.skillsMarketDetailMcp}</h3>
          <div className="skills-list">
            {entry.mcp.map((server) => (
              <div className="market-detail-row" key={server.name}>
                <span className="skills-row-name">{server.name}</span>
                <span className="skills-row-desc">{server.description}</span>
              </div>
            ))}
          </div>
        </section>
      ) : null}
      <section>
        <h3 className="skills-group-head">{copy.skillsMarketDetailSkills}</h3>
        <div className="skills-list">
          <div className="market-detail-row market-detail-skill">
            <span className="skills-row-icon" aria-hidden="true"><Icon name="skill" size={16} /></span>
            <span className="skills-row-copy">
              <span className="skills-row-name">{entry.skill}</span>
              <span className="skills-row-desc market-wrap">{description}</span>
            </span>
            <code className="market-chip">/skill:{entry.skill}</code>
          </div>
        </div>
      </section>
      <section>
        <h3 className="skills-group-head">{copy.skillsMarketDetailInfo}</h3>
        <dl className="skills-list market-info">
          <div className="market-detail-row">
            <dt>{copy.skillsMarketDeveloper}</dt>
            <dd>{marketplaceDeveloper(entry)}</dd>
          </div>
          <div className="market-detail-row">
            <dt>{copy.skillsMarketCategory}</dt>
            <dd>{copy.skillsMarketCategories[entry.category]}</dd>
          </div>
          {installs === null ? null : (
            <div className="market-detail-row">
              <dt>{copy.skillsMarketInstallCount}</dt>
              <dd>{installs.toLocaleString()}</dd>
            </div>
          )}
          <div className="market-detail-row">
            <dt>{copy.skillsMarketHomepage}</dt>
            <dd>
              <a href={homepage} target="_blank" rel="noreferrer noopener" className="market-link">
                {homepage.replace("https://", "")}
                <Icon name="external" size={12} />
              </a>
            </dd>
          </div>
          <div className="market-detail-row">
            <dt>{copy.skillsMarketCommand}</dt>
            <dd className="market-command-value">
              <code>{command}</code>
              <button
                className="skills-icon-btn"
                type="button"
                aria-label={copy.skillsMarketCopyCommand}
                title={copy.skillsMarketCopyCommand}
                onClick={() => void copyCommand()}
              >
                <Icon name="copy" size={14} />
              </button>
            </dd>
          </div>
        </dl>
      </section>
    </div>
  );
}
