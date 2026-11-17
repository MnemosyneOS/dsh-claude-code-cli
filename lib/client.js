/**
 * Claude Code Parity for DSH — Client-side panel (v2).
 *
 * Graphite-free graphical Claude Code workspace inside the DSH Web UI.
 * Contributes a sidebar entry (sidebar.panellist) and a main panel (main),
 * using DSH's window.__ModuleLoader__ + slots API.
 *
 * v2 adds: official Claude logo, Claude Code Desktop title, composer model
 * picker, any-format paste/drop upload, per-session drafts, generated topic
 * names, full session management, response stats, context progress,
 * interject (resume + priority note), workspace picker and sub-agent cards.
 */

window.__ModuleLoader__.load({
  // Must match package.json `name`: DSH resolves this id when it imports the
  // client entry, and a mismatch aborts the whole panel with
  // "could not load @local/dsh-claude-code-cli".
  id: '@local/dsh-claude-code-cli',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const { useState, useEffect, useRef, useMemo, useCallback } = React
    const API = '/api/claude-code-parity'
    const LOGO = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAQcAAAB5CAIAAAC7lnP1AAAMB0lEQVR4Ae2dQU7kPBCF5w70rVBfgZPMstWX4ARcAbHoBXvElgUnYNuL7H79Kump9KrsOOnYTOBJaOR27HL5ub6y0wnMn2m66kcKSAGvwB//QWUpIAWm6SoqtFVKAVZAVLAiSpZSQFSICinACogKVkSZUgqIClEhBVgBUcGKKFNKAVEhKqQAKyAqWBFlSikgKkSFFGAFRAUrokwpBUSFqJACrICoYEWUKaWAqBAVUoAVEBWsiDKlFBAVokIKsAKighVRppQCokJUSAFWQFSwIsqUUkBUiAopwAqIClZEmVIKiApRIQVYAVHBiihTSgFRISqkACsgKlgRZUopICpEhRRgBUQFK6JMKQVEhaiQAqyAqGBFlCmlgKgQFVKAFRAVrIgypRQQFaJCCrACooIVUaaUAqJCVEgBVkBUsCLKlFJAVIgKKcAKiApWRJlSCogKUSEFWAFRwYooU0oBUSEqpAArMJSKr4+398fT69+Hz+enr4+3ek6abVDvrqtSYLUCQ6kwJF7/Prz+fXh/PFWc/nx+smZio6KSLnVSYBwVXx9vFuj4txLxaFOHp5MoMvvLFfhOKkoRj41idkv55Yun6XdSYBwV03TFDoBCul14Kj6fnzrNXGalQEmBoVT4cDcw0qD3zdIGdtf+/nhKr5amuqj+cnmxn/P5dDzeH4/35/PJfqx+kbVpul4uL2bncnlZ2nfX7fc48aFUTNPV33AbGHHJPRVxM6H7k9ggGlxUY6t4ONy1/BgnFfvR2i+hIk78fK59v1LRcPyl0VRQTL/+fYhh7ckhRWL3rbaLuIqeiuPx3n+MZVryirWfTYVtpKlcJBGt7D/1sRcVXx9vpYcSPujT+2nfgMTCDQkKm1BxubxQoB+P96WTku0P1N4+wtv0qlX+bCrO51Np7r+dCp/R06hFTFuBtgtcpb6eFrRBIK4u0EIaDy3WqOPhcIde8RJi5WdTEfMLJi4qZh5N+DuHuF0g4j0V1MXa+AaIyEUF2uuXrhx1p6HTXeVnU2EKpBNfqi2JOfJjlxOU3yvSEI+33X67QBdUdkKCMvq6ZfNgxJWLufM3UGE6YJewwjp5o6QDarpQMU3X2TiO5Nhsfb3VpKZKTwDbJSMk/Pmn3Yh95Yrljx1FBcQRFf+/hFiKZuwAdJ9gxyHfy4IMW4cvxPhbVBORuGXNsF1EH0SFqOA3cvGSrA9oe2d2mq5+W7AGniXbDYgca3b77QSWygq3IDFNVzAmKrwC24rsLfcu9zpBeb99+gceFtkU9PZ9LkK/0tHbX1pGEGPZbqTCnk4cj/fRE+0VW4kcte1XM4IKvwOACoS+r7GXOHwNlW/fJXxqx4L103cFFXgQhoMZXjlpv1P3jxFbZufbLxoFb8SYmHg1ZpqukNcKjanncnnxNjH3llls1WYQFeZumvsp7mn3oKubTJtWa/V9doszi6jwoRmdtJr645TUQsXPtP0sFWmvksOon6Vi1uyshcpMF10aSkVl06DoTz+mG8XXxxteFmz5Lb/Nj091udupwM4Qo99yJ8LrcLiL8UHdfePUw2gTXepURAEPhzvL6BUfUp+9Y2TWDMIlX6i7522uLo+mwhxt2TQiGNbX7j0qW0oKDwQi9WdXCx3XFRqpIK9i0E/TlWKOgsPHDZVTz8ma70KWfXfy09SL7WOzus7embgZ+qvmZxzRO3l7+XuoWLdpVEjwCNWpiBKnIXi7smahhYoYQ+noZIpu7tPHyRZDJWtx3HrMUfsYvn4galyhwrcsrUVcNT/W5uUtqfh8fnp/PNkd8+fzk/3YCcf+jd6v2zQ8A1a2cUuj+HF9UqwHge+1ukyhfDjcxTznw6ISPbPbhTm5NIBo9NTDdV9RkNRpxNPoJZ2jjJQUSh3X1W9JRWMutxefAE8M8ZYa4Idngo3zp6UqBUGjtdlmcTk3pKIlzma/S2jxcN0XSiR16q1vkzaAwpH2qCQa31jYkor4VK4lvtvbtG8IFVH8Mli5n7j0PkhpOIrLSnBQZKT5krLvJlSQzXTcqDlJHedFZusLQY27prMtqYAu/tRkN8c4UPmCRXkLFbaxtByQ4EOpQEvVVdxGKux8YjcG5/OpEhzfRQWNG+M7VZukjr3IbGrEvq6llvatV0Wo1FR7ZRcq2offanvBgWp26KhvXK1ZI+0NaB+4BcJoKs3ZMafWvY1mY7RRfMcG6RDUK+pMDbyR0rOL+i2+t3BL+duoKL0ilW4ddh+fXoqV9TuNfVGB59wUQPZxDBVLMUM4ks9EBdFoc0lhsGcXjShi9FsK30MF3ZfTxxjoeG/cDmD19mic6hKpSGMr7buikta+ca9Ijw2Nni8N4lkPlxqESnUqollqby+PjIQBno+mIn4Va4EeSaCaGOulx3n15xUxCBojFZItKsThKstcypT4DXICI+U5Rlvd4VkPlxrEcBTltFdEs9bezkgVlWC/X2EcFfHI9P548i/J2je2BIP/GMGALrinrx+frD2t1iZU4IU2uGSF2ZhDe4qS9AD9LVTQoLNfamFGpDNREZWhBrAzvjCCishD+isWjZtGS9zXdYzLnCbduhG6ipim+rj2aRYkl0rxQc1St+EJgpJcoo+zHtKg7UkEDliBJjU7Lvk58mN3KuKRybYImyTuEGwfwEf6boqM3AhGXI/2lU7XBoFIC9/4zSy6p9HjR6QAHUMFudeu1VIq0un46fuybc5pivHN1pU7UlHZIsxXH+sW6KCCXpQiZrDVrJtz+v7CoiWhcbH8K6iIiJJx//FbqIgeNmoFWUq003Tqb7t4HQBqFNw3W13uSIW/JbB7Bp/jPRK4P7YuuH/wFqxN2mvd5FcvCQ2HFUoXNYYUpTff3R5OkX3/kXxOo5MMzqb2WQ/j6x6zNs3nWSri0C2WfS8vzoblXlTEI5B32l8FEqgEFagxPAyqrcDw4mL9luYeMkIR33KCag9iGquEUGxWmVT6rVecBdFYGtovcWQpZRjK+0LFYS9XpRl5svRjLyrsCIQ3NcgtvwngEsIdnNCfjQItaHnjUSoGUJrv4SEVYndq0EJFNJIuto8GBFAaZ9FgOqmUB7Mcv/5KbaajmwKpt6kbpZbW2N5/KT3KjGpvVdORipKLPqbTM5WngrYLXPI3LagsjVipT4PDnh9VerXfmcRVp0ycBpy9E4VoiKkaYJA18zltj9+opl9zSxubfc9nnAjaUOxWDII6r23JMuaYFtKJe7O3lEdT4ZGgaMatNtX7LvQ3zHHpFgnSEMeS4wmaDYHftY9L5WPIdonSetMrgLNh5J1Jx41Dx2axBs/L4iWrod2gNJ20e70xrVe9cbTfFYlpug6lAkGcnnxwrPIbiMkHYOIfpbWnHKTyio8W7nEBWmooeuKROjXie9XB8EeaUksKlNk4A0jpZlV6KXXWrO9YmjWG9svUYtkb9303Lw+lAnGPOwTMx5+UIhX+Km0XsLBVofKrnn6Z66+s+ZalsqeitF+lZ7k0gIiKksEYWJ6KxlePUgfMso94TLyulV+4kuXotu+1eXkcFdgoIhL0dCKdpAeDjlhp+00q7fjkT/kx+DYZCEZsy8JJHfVU8M3oEn2MU6AGdthbMS/vQ9rdhk4vRR98TfR5hRFvcGl5HBV2CkqRaKHCtxlGxVI11f5nKDCOCvvDsiXV/J1DqY1ZiOerSntdkgIrFBhKRcW/yi1HpZcuSYEeCvwrVGCv0OmoxzLL5iIF/hUqFjmtxlKgqwKigv/Pja5yy/guFBAVokIKsAKighXZRTKTk10VEBWiQgqwAqKCFemahGR8FwqIClEhBVgBUcGK7CKZycmuCogKUSEFWAFRwYp0TUIyvgsFRIWokAKsgKhgRXaRzORkVwVEhaiQAqyAqGBFuiYhGd+FAqJCVEgBVkBUsCK7SGZysqsCokJUSAFWQFSwIl2TkIzvQgFRISqkACsgKliRXSQzOdlVAVEhKqQAKyAqWJGuSUjGd6GAqBAVUoAVEBWsyC6SmZzsqoCoEBVSgBUQFaxI1yQk47tQQFSICinACogKVmQXyUxOdlVAVIgKKcAKiApWpGsSkvFdKCAqRIUUYAVEBSuyi2QmJ7sqICpEhRRgBUQFK9I1Ccn4LhQQFaJCCrAC/wFYc8dGpBMTnQAAAABJRU5ErkJggg=="
    const MARK = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAKAAAACgCAYAAACLz2ctAAAElElEQVR4nO3dvY0cORCAUUWkfM6/POQooQMUzuUi+YQATi1/qkg+4zO1Xd3zZjHNZY++/frx7zcpq/QB9HbpA+jt0gfQ26UPoLdLH0Bvlz6A3i59AL1d+gBf6Hew7Hm/N/3TlD1faukDfCEALyp9gC8E4EWlD/CFALyo9AE+6L+mKMD236+etwXWm+9pkOkDAAhg9QC8uPQBAASwev83RQHuvimJzrv7DVKq9AEABLB6AF5c+gAAAli96If6Xj+bZs9bbZ7SpQ8AIIDVA/Di0gcAEMDqtX/MHwXYlg2wPb/d1yv1DZCNC0AA04EBCGDpAASwVLNBzt4MsBvg7OsBIIAAVg5AAAEEsC7A3Q/hVNussPp4p92UAQgggAACCCCAbwCMnvDoQmj2TUn0+O0bZvX1XT0PgAACCCCAAAL4JsDZAEYf0mlBj87TO150w2z0DTcbXPT8AAQQQAABBBBAAD8p+4LtvimJgu8BHP0ypl6jmx8ABBBAAAEEEEAAPwGQfUFX35REf35vs8bs61P6CzABBBBAAAEEEMBrAPZaDbK3kD37BY2ez+ybpOj5lwpAAAEEEEAAAXwGYNvqF6Rt9k3J7IeiRst+PQEE8JzSBwAQwOwABLBUuxeyT6/U5gIA3wtAAAEE8N0ATAaaDWB3sx/k773ho78AQgvh2ZgABDAdFIAAHhWAAJbu9puW2WBmF/qyo2wsAAKYDgZAAK8q+wUAcDLA9oTbD8HtBs227IXS129adhd6CApAAQjgVQEI4F0As0+oV/uht63ah/Rq9a7P0gfbAcyfPzsAAQQQwHcrD3D2QzxaC6j0lxEBeF8ACkAA3+16gLPrbYhs6y10RzvtDTV6k9WrvR7RPzQACCCAAAIIIIAAVsxmhL2FNp9k4wDwvgAEEMBKAQjgVmC3bTY4/aYKwMMDsHgAAggggO8AnA3sNLCjD3n1HjIb/dL10JcnZWMCEMB0UAACeFQAAngUsLb2eNF/X+0/pgm94BMafQMACCCAAAIIIIBvAly9OaC3YTK6cNvb0JkNsDdv9i8UAAGsG4AAAggggCub/cfy0Jdg/wVk9Hjtz+vdhLQARo8/ulBcGiSAAAIIIIAAAngtwFFwow9Cj4KL/rzewvDo9RjdgFsKJIAAAggggAACeA3A6ELz7AuyGvgowNGF+N5N2FEgAQQQQAABBBDAawDubvUFjy4kRzdsji7U995A2b8QAAQQQAABBBBAAGc0e3PBbCCjD+1Ezyd6fu18vc0NUx9CAhBAAAEEEEAAAfyw0YXb0eNHN4Bmn290w257vKXgAAQQQAABBBBAAD8s+gKMbmAdPf7s8x9dqM5+/QAEsG7pAwAIYPUABLA0wNngqgFs690URW9CAAQQwMoBCCCAAL4LcOvC6IEf+ndfn6mlD1DwAgO4sfQBCl5gADeWPkDBCwzgxtIHKFh0M8BRH/qrlT5AwQDcWPoABQNwY+kDFAzAjaUPcEC9B99XL4RfXfoABwTgwtIHOCAAF5Y+wAEBuLD0AfR26QPo7dIH0NulD6C3Sx9Ab5c+gN4ufQC9XfoAers/XXGqwCFVNMkAAAAASUVORK5CYII="
    const PANEL_ID = 'claude-code-parity'
    const LANG_KEY = 'ccp.lang'
    const DRAFT_KEY = 'ccp.drafts'

    /* ================================================================ i18n */
    const I18N = {
      zh: {
        title: 'Claude Code Desktop', newSession: '新会话', send: '发送', stop: '停止',
        interject: '插话', interjecting: '正在插话并续接上一任务…',
        placeholder: '描述任务，Shift+Tab 切换权限模式…',
        history: '历史会话', search: '搜索会话', noSessions: '还没有会话，发一条消息开始',
        thinking: '思考过程', tools: '工具调用', result: '完成', error: '出错',
        copy: '复制', copied: '已复制', model: '模型', settings: '设置',
        approval: '工具审批', approve: '允许', always: '始终允许', deny: '拒绝',
        pendingApproval: '等待审批', upload: '附件', rename: '重命名', archive: '归档',
        restore: '恢复', trash: '回收站', remove: '删除', export: '导出 Markdown',
        branchInNew: '在新会话中分支',
        confirmTitle: '确认操作', confirm: '确认', confirmDelete: '将把该会话移入回收站，可随时恢复。确定继续？',
        confirmBatchDelete: '将把选中的会话移入回收站，可随时恢复。确定继续？',
        pin: '置顶', unpin: '取消置顶', openTerminal: '在终端打开',
        upgrade: '升级 Claude CLI', upgradeCheck: '检查更新', current: '当前版本',
        upgradeLatest: '最新版本', upgradeNew: '有新版本可更新', upgradeOk: '已是最新版本',
        upgradeRun: '开始更新', upgradeRunning: '更新中…', upgradeLog: '更新日志',
        upgradeFailed: '检查失败', upgradeDone: '更新完成', upgradeNoChange: '更新已执行，版本未变化',
        upgradeReinstall: '重新安装最新版', upgradeUpToDateHint: '当前已是最新版本，重新安装不会改变版本号',
        upgradeElapsed: '已运行', upgradeStartFailed: '更新未能启动',
        upgradeStale: '当前运行的是旧代码（源文件在此进程启动之后被修改过），请完全退出并重开 DSH 后再更新',
        upgradeBuild: '加载于',
        mobile: '手机访问', mobileHint: '同一 Wi-Fi 下，用手机浏览器打开下面的地址，即可使用完整的 DSH 界面（含本插件）',
        mobileStart: '启动手机访问', mobileStop: '停止手机访问', mobileAddr: '手机浏览器打开',
        mobileIfaces: '网卡地址', mobileCopy: '复制链接', mobileStarting: '正在启动，首次约需 10–30 秒…',
        mobileShort: '短地址（自动跳转）', mobileLong: '带令牌的完整地址',
        layout: '布局', layoutSingle: '单栏', layoutSplitH: '左右分栏', layoutSplitV: '上下分栏',
        start: '开始', startFiles: '工作区文件', startFilesSub: '浏览会话工作区文件',
        startTerm: '新建终端', startTermSub: '在会话工作区运行命令',
        startBrowser: '浏览器', startBrowserSub: '浏览网页',
        startDiag: '会话数据诊断', startDiagSub: '查看当前会话原始日志与运行状态',
        startMore: '更多工具', startBack: '返回', startRun: '运行', startOpen: '打开',
        startEmptyDir: '（空目录）', startLoading: '加载中…', startNoCwd: '未设置工作区',
        startPickCwd: '请先在顶栏选择工作区', startInsert: '插入路径', startCmd: '输入命令后回车运行',
        startUrl: '输入网址后回车打开', startRefresh: '刷新', startUp: '上一级',
        back: '返回', save: '保存', reset: '恢复默认',
        saved: '已保存', saving: '保存中', language: '语言', theme: '主题',
        permissionMode: '权限模式', autoApprove: '自动批准', timeout: '超时',
        general: '常规', appearance: '外观', toolsGroup: '工具与权限',
        modelGroup: '模型', sessionGroup: '会话', advanced: '高级',
        connectFail: '后端未连接', connectHint: '请确认 DSH 正在运行',
        addFile: '添加文件', pasteHint: '',
        modeLabels: {
          acceptEdits: '接受编辑', auto: '自动', manual: '手动',
          plan: '计划', dontAsk: '不询问', bypassPermissions: '完全访问',
          none: '关闭', host: '宿主审批', all: '全部放行',
          claude: 'Claude 配色', dark: '深色', light: '浅色',
          verbose: '完整', compact: '紧凑', zh: '中文', en: 'English',
          minimal: '最小', low: '低', medium: '中', high: '高',
          image_url: 'URL 图像', path_only: '仅路径',
          markdown: 'Markdown', txt: '纯文本',
        },
        ctxTitle: '上下文用量', ctxUsed: '已使用', ctxDefault: '默认',
        stopReason: '停止原因', tokens: 'Token', duration: '耗时', turns: '轮次',
        loading: '加载中…', noModel: '未配置模型，请先在设置里选择',
        welcomeTitle: 'Claude Code Desktop',
        welcomeDesc: '会话、附件、思考链、工具审批、子代理、历史与设置',
        cliReady: 'CLI 就绪', cliMissing: 'CLI 未找到',
        prefill: '预填充', decode: '生成', generatedAt: '生成于',
        context: '上下文', today: '今日', batch: '批量', selectAll: '全选',
        cancelBatch: '取消批量', batchArchive: '批量归档', batchDelete: '批量删除',
        batchPin: '批量置顶', branch: '创建分支', copyId: '复制 ID', group: '分组',
        groupName: '分组名称', workspace: '工作区', customWorkspace: '自定义工作区…',
        agent: '子代理', noAgents: '暂无子代理', subtasks: '子任务',
      },
      en: {
        title: 'Claude Code Desktop', newSession: 'New session', send: 'Send', stop: 'Stop',
        interject: 'Interject', interjecting: 'Interjecting and resuming the previous task…',
        placeholder: 'Describe a task, Shift+Tab to switch permission mode…',
        history: 'History', search: 'Search sessions', noSessions: 'No sessions yet — send a message to start',
        thinking: 'Thinking', tools: 'Tool calls', result: 'Done', error: 'Error',
        copy: 'Copy', copied: 'Copied', model: 'Model', settings: 'Settings',
        approval: 'Tool approval', approve: 'Allow', always: 'Always', deny: 'Deny',
        pendingApproval: 'Awaiting approval', upload: 'Attachments', rename: 'Rename', archive: 'Archive',
        restore: 'Restore', trash: 'Trash', remove: 'Delete', export: 'Export Markdown',
        branchInNew: 'Branch into a new session',
        confirmTitle: 'Confirm', confirm: 'Confirm', confirmDelete: 'This session will be moved to Trash and can be restored. Continue?',
        confirmBatchDelete: 'The selected sessions will be moved to Trash and can be restored. Continue?',
        pin: 'Pin', unpin: 'Unpin', openTerminal: 'Open in terminal',
        upgrade: 'Upgrade Claude CLI', upgradeCheck: 'Check update', current: 'Current version',
        upgradeLatest: 'Latest version', upgradeNew: 'An update is available', upgradeOk: 'Already up to date',
        upgradeRun: 'Install update', upgradeRunning: 'Updating…', upgradeLog: 'Update log',
        upgradeFailed: 'Check failed', upgradeDone: 'Update finished', upgradeNoChange: 'Update ran but the version did not change',
        upgradeReinstall: 'Reinstall latest', upgradeUpToDateHint: 'Already on the latest version — reinstalling will not change the version number',
        upgradeElapsed: 'elapsed', upgradeStartFailed: 'Update could not start',
        upgradeStale: 'This process is running older code (the source changed after it started). Fully quit and reopen DSH, then update again.',
        upgradeBuild: 'loaded',
        mobile: 'Mobile access', mobileHint: 'On the same Wi-Fi, open the address below in a phone browser to use the full DSH UI (this plugin included)',
        mobileStart: 'Start mobile access', mobileStop: 'Stop mobile access', mobileAddr: 'Open on your phone',
        mobileIfaces: 'Interface', mobileCopy: 'Copy link', mobileStarting: 'Starting — the first launch takes 10–30 s…',
        mobileShort: 'Short address (auto-redirect)', mobileLong: 'Full tokenised address',
        layout: 'Layout', layoutSingle: 'Single pane', layoutSplitH: 'Split left / right', layoutSplitV: 'Split top / bottom',
        start: 'Start', startFiles: 'Workspace files', startFilesSub: 'Browse the session workspace',
        startTerm: 'New terminal', startTermSub: 'Run a command in the session workspace',
        startBrowser: 'Browser', startBrowserSub: 'Open a web page',
        startDiag: 'Session diagnostics', startDiagSub: 'Raw logs and runtime state for this session',
        startMore: 'More tools', startBack: 'Back', startRun: 'Run', startOpen: 'Open',
        startEmptyDir: '(empty folder)', startLoading: 'Loading…', startNoCwd: 'No workspace set',
        startPickCwd: 'Pick a workspace in the top bar first', startInsert: 'Insert path', startCmd: 'Type a command and press Enter',
        startUrl: 'Type a URL and press Enter', startRefresh: 'Refresh', startUp: 'Up',
        back: 'Back', save: 'Save', reset: 'Reset defaults',
        saved: 'Saved', saving: 'Saving', language: 'Language', theme: 'Theme',
        permissionMode: 'Permission mode', autoApprove: 'Auto approve', timeout: 'Timeout',
        general: 'General', appearance: 'Appearance', toolsGroup: 'Tools & Permissions',
        modelGroup: 'Model', sessionGroup: 'Session', advanced: 'Advanced',
        connectFail: 'Backend not connected', connectHint: 'Make sure DSH is running',
        addFile: 'Add file', pasteHint: '',
        modeLabels: {
          acceptEdits: 'Accept edits', auto: 'Auto', manual: 'Manual',
          plan: 'Plan', dontAsk: 'Don\'t ask', bypassPermissions: 'Full access',
          none: 'Off', host: 'Host approval', all: 'Allow all',
          claude: 'Claude', dark: 'Dark', light: 'Light',
          verbose: 'Verbose', compact: 'Compact', zh: '中文', en: 'English',
          minimal: 'Minimal', low: 'Low', medium: 'Medium', high: 'High',
          image_url: 'Image URL', path_only: 'Path only',
          markdown: 'Markdown', txt: 'Plain text',
        },
        ctxTitle: 'Context usage', ctxUsed: 'Used', ctxDefault: 'Default',
        stopReason: 'Stop reason', tokens: 'Tokens', duration: 'Duration', turns: 'Turns',
        loading: 'Loading…', noModel: 'No model configured — select one in Settings',
        welcomeTitle: 'Claude Code Desktop',
        welcomeDesc: 'Sessions · attachments · thinking · tool approvals · sub-agents · history · settings',
        cliReady: 'CLI ready', cliMissing: 'CLI not found',
        prefill: 'Prefill', decode: 'Decode', generatedAt: 'Generated at',
        context: 'Context', today: 'Today', batch: 'Batch', selectAll: 'Select all',
        cancelBatch: 'Exit batch', batchArchive: 'Archive selected', batchDelete: 'Delete selected',
        batchPin: 'Pin selected', branch: 'Branch', copyId: 'Copy ID', group: 'Group',
        groupName: 'Group name', workspace: 'Workspace', customWorkspace: 'Custom workspace…',
        agent: 'Sub-agent', noAgents: 'No sub-agents yet', subtasks: 'Subtasks',
      },
    }
    function readLang() {
      try { const v = localStorage.getItem(LANG_KEY); return v === 'en' || v === 'zh' ? v : 'zh' }
      catch (e) { return 'zh' }
    }

    /* ============================================================== palette */
    const PALETTES = {
      claude: {
        bg: '#faf9f7', panel: '#ffffff', ink: '#1e1d1b', ink2: '#6b6862', line: '#e8e6e1',
        coral: '#d97757', coralSoft: '#f7ece5', accent: '#8a8578', sel: '#f0eee6', clay: '#b5694b',
      },
      dark: {
        bg: '#1f1e1d', panel: '#262524', ink: '#ecebe8', ink2: '#a5a39e', line: '#3a3836',
        coral: '#d97757', coralSoft: '#3a2b23', accent: '#b9ada2', sel: '#32302e', clay: '#c9805f',
      },
      light: {
        bg: '#ffffff', panel: '#fafafa', ink: '#242424', ink2: '#666', line: '#e5e5e5',
        coral: '#d97757', coralSoft: '#f9efe9', accent: '#555', sel: '#f2f2f2', clay: '#b5694b',
      },
    }
    const C = PALETTES.claude

    /** CSS custom properties for the chosen theme; inline beats the baked rule. */
    function themeStyle(theme) {
      const p = PALETTES[theme] || PALETTES.claude
      return {
        '--bg': p.bg, '--panel': p.panel, '--ink': p.ink, '--ink2': p.ink2,
        '--line': p.line, '--coral': p.coral, '--coralSoft': p.coralSoft,
        '--accent': p.accent, '--sel': p.sel, '--clay': p.clay,
      }
    }

    /* ================================================================== API */
    async function api(path, opts = {}) {
      // A fetch without a deadline is how one stuck request turns the whole
      // panel into "working…" forever: the busy flag is only cleared in a
      // `finally`, so a promise that never settles leaves the input locked and
      // no error anywhere. Every call gets a ceiling.
      const timeoutMs = Number(opts.timeout) > 0 ? Number(opts.timeout) : 120000
      const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null
      const timer = ctrl ? setTimeout(() => { try { ctrl.abort() } catch (e) { /* ignore */ } }, timeoutMs) : null
      let res
      try {
        res = await fetch(API + path, {
          method: opts.method || 'GET',
          headers: { 'content-type': 'application/json', ...(opts.headers || {}) },
          body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
          signal: ctrl ? ctrl.signal : undefined,
        })
      } catch (e) {
        if (timer) clearTimeout(timer)
        if (e && e.name === 'AbortError') {
          throw new Error('请求超时：' + Math.round(timeoutMs / 1000) + ' 秒内没有响应（服务端可能仍在处理，可稍后重试）')
        }
        throw e
      }
      if (timer) clearTimeout(timer)
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`)
      return data
    }

    /**
     * Stream one attachment to disk.
     *
     * Deliberately not `api()`: that JSON-encodes the payload, which is exactly
     * what a multi-hundred-megabyte video cannot survive. Here the bytes go out
     * as a raw body, so the browser never builds a giant string and the server
     * never buffers the file in memory.
     */
    async function uploadAttachment(att, sid) {
      const q = '?name=' + encodeURIComponent(att.name || 'attachment')
        + '&session_key=' + encodeURIComponent(sid)
        + '&kind=' + encodeURIComponent(att.kind || 'file')
      let body
      if (typeof Blob !== 'undefined' && att.blob instanceof Blob) {
        body = att.blob
      } else if (att.base64) {
        const bin = atob(String(att.data || '').replace(/^data:[^;]+;base64,/, ''))
        const bytes = new Uint8Array(bin.length)
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
        body = new Blob([bytes])
      } else if (att.data) {
        body = new Blob([String(att.data)], { type: 'text/plain;charset=utf-8' })
      } else {
        // Drafts are JSON in localStorage, so a File cannot survive a reload.
        throw new Error('附件内容已丢失，请重新添加')
      }
      const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null
      const timer = ctrl ? setTimeout(() => { try { ctrl.abort() } catch (e) { /* ignore */ } }, 600000) : null
      let res
      try {
        res = await fetch(API + '/upload/raw' + q, {
          method: 'POST',
          body,
          signal: ctrl ? ctrl.signal : undefined,
        })
      } catch (e) {
        if (e && e.name === 'AbortError') throw new Error('上传超过 10 分钟未完成')
        throw e
      } finally {
        if (timer) clearTimeout(timer)
      }
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || ('HTTP ' + res.status))
      return data
    }

    /* ============================================================== helpers */
    function uid() { return 'id-' + Math.random().toString(36).slice(2, 10) }
    function fmtTime(ts) {
      if (!ts) return ''
      try { return new Date(ts).toLocaleString() } catch (e) { return String(ts) }
    }
    function fmtTokens(n) {
      n = Number(n) || 0
      return n >= 1000 ? (n / 1000).toFixed(1) + 'k' : String(n)
    }
    function fmtTps(n) {
      return Number.isFinite(Number(n)) && Number(n) > 0 ? Number(n).toFixed(1) + ' tok/s' : '-'
    }
    async function copyText(text) {
      try { await navigator.clipboard.writeText(text) } catch (e) {
        const ta = document.createElement('textarea')
        ta.value = text; document.body.appendChild(ta); ta.select()
        try { document.execCommand('copy') } catch (x) {}
        document.body.removeChild(ta)
      }
    }
    function loadDrafts() {
      try { return JSON.parse(localStorage.getItem(DRAFT_KEY) || '{}') || {} } catch (e) { return {} }
    }
    function saveDrafts(d) {
      try { localStorage.setItem(DRAFT_KEY, JSON.stringify(d)) } catch (e) { /* quota */ }
    }
    function draftKey(id) { return id || '__new__' }
    function dayKey() { return 'ccp.day.' + new Date().toISOString().slice(0, 10) }
    function loadDay() { try { return Number(localStorage.getItem(dayKey()) || 0) } catch (e) { return 0 } }
    /** Friendly label for the active model — always derived from real catalog data. */
    function modelLabel(modelInfo, settings) {
      const sel = modelInfo.selected
      const id = sel?.model || settings?.model || ''
      if (!id) return '模型'
      const hit = (modelInfo.models || []).find((m) => m.model === id && (!sel?.provider || m.provider === sel.provider))
        || (modelInfo.models || []).find((m) => m.model === id)
      return (hit && hit.name) || id
    }
    /** Provider display name from the live catalog. */
    function providerLabel(modelInfo, providerId) {
      const hit = (modelInfo.models || []).find((m) => m.provider === providerId)
      return (hit && hit.providerName) || providerId || '-'
    }
    function shortModel(modelInfo, settings) {
      const label = modelLabel(modelInfo, settings)
      return label.length > 22 ? label.slice(0, 21) + '…' : label
    }
    function kindOfFile(file) {
      const n = String(file.name || '').toLowerCase()
      const mime = String(file.type || '')
      if (/^image\//.test(mime)) return 'image'
      if (mime === 'application/pdf' || /\.(pdf|docx?|xlsx?|pptx?|rtf|odt|ods|odp|epub|txt|md|csv)$/.test(n)) return 'doc'
      return 'file'
    }
    function readFileAsAttachment(file) {
      const kind = kindOfFile(file)
      if (kind !== 'image') {
        // Keep the File itself. Base64'ing a 200 MB video only to inflate it a
        // further 33% into a JSON request body is what made large attachments
        // blow past the 32 MB body cap and wedge the panel; the upload path now
        // streams these bytes straight to disk.
        return Promise.resolve({ name: file.name, kind, blob: file, base64: false, data: '', text: '' })
      }
      return new Promise((resolve) => {
        const reader = new FileReader()
        reader.onload = () => resolve({ name: file.name, kind, base64: true, data: String(reader.result || ''), text: '' })
        reader.onerror = () => resolve(null)
        reader.readAsDataURL(file)
      })
    }

    /* ================================================================ icons */
    /** Square starburst mark — for icon slots (sidebar, avatar, agent). */
    function Logo({ size = 20 }) {
      return h('img', {
        src: MARK, width: size, height: size, alt: 'Claude',
        style: { display: 'block', objectFit: 'contain', flex: '0 0 auto' },
      })
    }
    /**
     * Official Claude Code Desktop lockup: starburst mark + "Claude Code" + "Desktop" pill.
     * Geometry is taken from the official artwork (mark 36px, gap 15px, pill radius = full),
     * scaled proportionally so every size keeps the same visual rhythm.
     */
    function BrandLockup({ size = 20, showPill = true, compact = false }) {
      // Ratios measured from the official lockup artwork (mark 36px):
      //   wordmark cap height 19 (0.53 x mark), pill 92x32 (0.89 x mark),
      //   mark->word gap 15 (0.42 x mark), pill side padding 11.5 (0.32 x mark).
      const wordSize = Math.max(10, Math.round(size * 0.727))
      // "Desktop" reads as a sub-label: about a third of the wordmark, sitting
      // at its lower right rather than vertically centred.
      const pillSize = Math.max(8, Math.round(size * 0.26))
      const gapMarkWord = Math.max(4, Math.round(size * 0.417))
      // Same breathing room as between the mark and the wordmark.
      const gapWordPill = compact ? Math.max(4, Math.round(size * 0.3)) : gapMarkWord
      const padY = Math.max(2, Math.round(size * 0.14))
      const padX = Math.max(4, Math.round(size * 0.26))
      return h('span', { className: 'ccp-lockup', style: { gap: 0 } },
        h('img', { src: MARK, width: size, height: size, alt: 'Claude', className: 'ccp-lockup-mark' }),
        h('span', {
          className: 'ccp-lockup-word',
          style: { fontSize: wordSize, marginLeft: gapMarkWord },
        }, 'Claude Code'),
        showPill ? h('span', {
          className: 'ccp-lockup-pill',
          style: {
            fontSize: pillSize,
            lineHeight: 1,
            marginLeft: gapWordPill,
            alignSelf: 'flex-end',
            marginBottom: Math.max(1, Math.round(size * 0.14)),
            padding: Math.max(1, Math.round(padY * 0.7)) + 'px ' + Math.max(3, Math.round(padX * 0.8)) + 'px',
          },
        }, 'Desktop') : null,
      )
    }
    function Icon({ name, size = 15, color = 'currentColor' }) {
      const paths = {
        plus: ['M12 5v14', 'M5 12h14'],
        send: ['M4 12l16-8-6 16-3-7-7-1z'],
        stop: ['M7 7h10v10H7z'],
        search: ['M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14z', 'M20 20l-4-4'],
        copy: ['M9 9h10v10H9z', 'M5 15H3V5h10v2'],
        settings: ['M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8z', 'M12 2v3', 'M12 19v3', 'M2 12h3', 'M19 12h3'],
        trash: ['M4 7h16', 'M9 7V4h6v3', 'M6 7l1 13h10l1-13'],
        pin: ['M12 2l3 7 7 3-7 3-3 7-3-7-7-3 7-3z'],
        chevron: ['M8 10l4 4 4-4'],
        paperclip: ['M21 11l-8 8a5 5 0 0 1-7-7l9-9a3 3 0 0 1 4 4l-9 9a1 1 0 0 1-1-1l8-8'],
        check: ['M4 12l5 5L20 6'],
        x: ['M6 6l12 12', 'M18 6L6 18'],
        edit: ['M4 20h4l10-10-4-4L4 16z'],
        refresh: ['M20 6v5h-5', 'M4 18v-5h5', 'M6 9a7 7 0 0 1 12-3l2 5', 'M18 15a7 7 0 0 1-12 3l-2-5'],
        back: ['M15 18l-6-6 6-6'],
        more: ['M5 12h.01', 'M12 12h.01', 'M19 12h.01'],
        branch: ['M6 3v12', 'M6 7h6a4 4 0 0 1 4 4v3', 'M18 14l-2 3-2-3', 'M6 18a2 2 0 1 0 0-4 2 2 0 0 0 0 4z'],
        folder: ['M3 6h6l2 2h10v11H3z'],
        cube: ['M12 2l8 4v12l-8 4-8-4V6z', 'M4 6l8 4 8-4', 'M12 10v12'],
        bolt: ['M13 2L4 14h7l-1 8 9-12h-7z'],
        layers: ['M12 3l9 5-9 5-9-5z', 'M3 12l9 5 9-5', 'M3 16l9 5 9-5'],
        archive: ['M3 5h18v4H3z', 'M5 9v11h14V9', 'M10 13h4'],
        speed: ['M12 20a8 8 0 1 1 8-8', 'M12 12l4-3'],
        cache: ['M4 6c0-1.7 3.6-3 8-3s8 1.3 8 3-3.6 3-8 3-8-1.3-8-3z', 'M4 6v12c0 1.7 3.6 3 8 3s8-1.3 8-3V6', 'M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3'],
        terminal: ['M4 6l4 4-4 4', 'M12 14h8'],
        read: ['M4 5h7v14H4z', 'M13 5h7v14h-7z'],
        write: ['M4 20h16', 'M6 16l9-9 3 3-9 9H6z'],
        think: ['M12 3l2.2 5.4L20 10l-5.8 1.6L12 17l-2.2-5.4L4 10l5.8-1.6z'],
        agent: ['M12 3v4', 'M6 7h12v9H6z', 'M9 12h.01', 'M15 12h.01', 'M9 20h6'],
        play: ['M8 5l11 7-11 7z'],
        globe: ['M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z', 'M3 12h18', 'M12 3c3 3.5 3 14 0 18', 'M12 3c-3 3.5-3 14 0 18'],
      }
      return h('svg', { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: color, strokeWidth: 1.7, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true },
        ...(paths[name] || []).map((d, i) => h('path', { key: i, d })),
      )
    }

    /* ============================================================ start panel */
    function fmtSize(n) {
      const v = Number(n) || 0
      if (v < 1024) return v + ' B'
      if (v < 1048576) return (v / 1024).toFixed(1) + ' KB'
      return (v / 1048576).toFixed(1) + ' MB'
    }

    function joinPath(dir, name) {
      if (!dir) return name
      const sep = dir.indexOf('\\') >= 0 ? '\\' : '/'
      return dir.endsWith(sep) ? dir + name : dir + sep + name
    }

    /**
     * The second pane: a "Start" surface with real actions, not decoration.
     * Every card calls a real endpoint — files list the workspace, the terminal
     * runs a command, diagnostics reads live runtime state.
     */
    function StartPanel({ t, cwd, onInsert, notify, onOpenSettings, onExport, mode, setMode }) {
      const [listing, setListing] = useState(null) // { dir, parent, entries }
      const [busy, setBusy] = useState(false)
      const [err, setErr] = useState('')
      const [cmd, setCmd] = useState('')
      const [term, setTerm] = useState(null)
      const [url, setUrl] = useState('')
      const [diag, setDiag] = useState(null)

      const loadFiles = async (target) => {
        setBusy(true); setErr('')
        try {
          const r = await api('/files?dir=' + encodeURIComponent(target || cwd || ''))
          setListing({ dir: r.dir, parent: r.parent, entries: r.entries || [] })
        } catch (e) { setErr(e.message || ''); setListing(null) }
        setBusy(false)
      }
      const loadDiag = async () => {
        setBusy(true); setErr('')
        try { setDiag(await api('/diagnostics')) } catch (e) { setErr(e.message || '') }
        setBusy(false)
      }
      const go = (key) => setMode(key)

      // Loading is driven by the mode so the parent can open a card directly
      // (keyboard shortcut) without duplicating the fetch logic here.
      useEffect(() => {
        setErr('')
        if (mode === 'files') loadFiles(cwd)
        else if (mode === 'diag') loadDiag()
        else if (mode === 'term') setTerm(null)
        // eslint-disable-next-line react-hooks/exhaustive-deps
      }, [mode])
      const runCmd = async () => {
        const c = cmd.trim()
        if (!c || busy) return
        setBusy(true); setErr(''); setTerm(null)
        try { setTerm(await api('/exec', { method: 'POST', body: { command: c, cwd } })) } catch (e) { setErr(e.message || '') }
        setBusy(false)
      }
      const openUrl = () => {
        let u = url.trim()
        if (!u) return
        if (!/^https?:\/\//i.test(u)) u = 'https://' + u
        try { window.open(u, '_blank', 'noopener,noreferrer') } catch (e) { setErr(String(e && e.message || e)) }
      }

      const card = (key, icon, title, sub, shortcut) => h('button', {
        key, className: 'ccp-start-card', onClick: () => go(key),
      },
        h('span', { className: 'ccp-start-ico' }, h(Icon, { name: icon, size: 15 })),
        h('span', { style: { flex: 1, minWidth: 0 } },
          h('div', { className: 'ccp-start-t' }, title),
          sub ? h('div', { className: 'ccp-start-s' }, sub) : null,
        ),
        shortcut ? h('span', { className: 'ccp-start-k' }, shortcut) : null,
      )

      const row = (key, icon, title, onClick) => h('button', {
        key, className: 'ccp-start-card', onClick,
      },
        h('span', { className: 'ccp-start-ico' }, h(Icon, { name: icon, size: 15 })),
        h('span', { style: { flex: 1, minWidth: 0 } }, h('div', { className: 'ccp-start-t' }, title)),
      )

      const head = h('div', { className: 'ccp-start-head' },
        h(Icon, { name: 'play', size: 12 }),
        h('b', {}, t.start),
        mode !== 'home'
          ? h('button', {
            className: 'ccp-iconbtn', style: { marginLeft: 'auto' }, title: t.startBack,
            onClick: () => { setMode('home'); setErr('') },
          }, h(Icon, { name: 'back', size: 14 }))
          : null,
      )

      const body = mode === 'home'
        ? h('div', { className: 'ccp-start-body' },
          h('div', { className: 'ccp-start-hero' },
            h('img', { src: MARK, width: 42, height: 42, alt: '', style: { opacity: 0.3 } })),
          card('files', 'folder', t.startFiles, t.startFilesSub, 'Ctrl + P'),
          card('term', 'terminal', t.startTerm, t.startTermSub, 'Ctrl + `'),
          card('browser', 'globe', t.startBrowser, t.startBrowserSub, 'Ctrl + T'),
          card('diag', 'cube', t.startDiag, t.startDiagSub, ''),
          card('more', 'layers', t.startMore, '', ''),
        )
        : mode === 'files'
          ? h('div', { className: 'ccp-start-body' },
            h('div', { className: 'ccp-start-bar' },
              h('button', {
                className: 'ccp-iconbtn', title: t.startUp, disabled: busy || !listing?.parent,
                onClick: () => loadFiles(listing?.parent || ''),
              }, h(Icon, { name: 'back', size: 14 })),
              h('span', { className: 'ccp-start-path', title: listing?.dir || '' }, listing?.dir || t.startLoading),
              h('button', {
                className: 'ccp-iconbtn', title: t.startRefresh,
                onClick: () => loadFiles(listing?.dir || cwd),
              }, h(Icon, { name: 'refresh', size: 13 })),
            ),
            err ? h('div', { className: 'ccp-hint', style: { color: C.coral, marginBottom: 8 } }, err) : null,
            h('div', { className: 'ccp-start-list' },
              ...(listing?.entries || []).map((e) => h('div', {
                key: e.name, className: 'ccp-start-row', title: joinPath(listing.dir, e.name),
                onClick: () => {
                  if (e.dir) loadFiles(joinPath(listing.dir, e.name))
                  else { onInsert('@' + joinPath(listing.dir, e.name) + ' '); notify(t.startInsert) }
                },
              },
                h(Icon, { name: e.dir ? 'folder' : 'read', size: 13 }),
                h('span', { className: 'nm' }, e.name),
                h('span', { className: 'mt' }, e.dir ? '' : fmtSize(e.size)),
              )),
              !busy && listing && !listing.entries.length
                ? h('div', { className: 'ccp-start-s' }, t.startEmptyDir) : null,
              busy && !listing ? h('div', { className: 'ccp-start-s' }, t.startLoading) : null,
            ),
          )
          : mode === 'term'
            ? h('div', { className: 'ccp-start-body' },
              h('div', { className: 'ccp-start-bar' },
                h('input', {
                  className: 'ccp-input', style: { flex: 1 }, placeholder: t.startCmd, value: cmd,
                  onChange: (e) => setCmd(e.target.value),
                  onKeyDown: (e) => { if (e.key === 'Enter') { e.preventDefault(); runCmd() } },
                }),
                h('button', { className: 'ccp-btn primary', onClick: runCmd, disabled: busy || !cmd.trim() },
                  busy ? '…' : t.startRun),
              ),
              h('div', { className: 'ccp-start-s', style: { marginBottom: 4 } }, cwd || listing?.dir || ''),
              err ? h('div', { className: 'ccp-hint', style: { color: C.coral } }, err) : null,
              term
                ? h('pre', { className: 'ccp-start-pre' + (term.code ? ' err' : '') },
                  (term.stdout || '')
                  + (term.stderr ? (term.stdout ? '\n' : '') + term.stderr : '')
                  + '\n[exit ' + term.code + ' · ' + term.ms + 'ms]')
                : null,
            )
            : mode === 'browser'
              ? h('div', { className: 'ccp-start-body' },
                h('div', { className: 'ccp-start-bar' },
                  h('input', {
                    className: 'ccp-input', style: { flex: 1 }, placeholder: t.startUrl, value: url,
                    onChange: (e) => setUrl(e.target.value),
                    onKeyDown: (e) => { if (e.key === 'Enter') { e.preventDefault(); openUrl() } },
                  }),
                  h('button', { className: 'ccp-btn primary', onClick: openUrl, disabled: !url.trim() }, t.startOpen),
                ),
                h('div', { className: 'ccp-start-s' }, 'Ctrl + T'),
                err ? h('div', { className: 'ccp-hint', style: { color: C.coral } }, err) : null,
              )
              : mode === 'diag'
                ? h('div', { className: 'ccp-start-body' },
                  err ? h('div', { className: 'ccp-hint', style: { color: C.coral } }, err) : null,
                  diag
                    ? h('dl', { className: 'ccp-start-kv' },
                      ...[
                        ['插件', diag.plugin.name + ' ' + diag.plugin.version],
                        ['PID', String(diag.pid)],
                        ['运行时长', Math.round(diag.uptimeMs / 1000) + ' s'],
                        ['桥端口', diag.bridge ? String(diag.bridge.port) : '-'],
                        ['CLI 版本', diag.cli.version || '-'],
                        ['CLI 路径', diag.cli.path || '-'],
                        ['当前模型', (diag.selection?.provider || '-') + ' / ' + (diag.selection?.model || '-')],
                        ['权限模式', diag.settings.permission_mode || '-'],
                        ['默认工作区', diag.settings.default_cwd || '-'],
                        ['保留历史', diag.settings.keep_history === false ? '否' : '是'],
                        ['会话数', String(diag.counts.sessions)],
                        ['CLI 元数据', String(diag.counts.cliMeta)],
                        ['任务数', String(diag.counts.jobs)],
                        ['上传目录', String(diag.counts.uploads)],
                        ['代码版本', diag.build.stale ? '旧代码（需重开 DSH）' : '当前代码'],
                        ['加载于', new Date(diag.build.loadedAt).toLocaleString()],
                      ].flatMap(([k, v]) => [
                        h('dt', { key: 'k' + k }, k),
                        h('dd', { key: 'v' + k }, String(v)),
                      ]),
                    )
                    : h('div', { className: 'ccp-start-s' }, busy ? t.startLoading : ''),
                )
                : h('div', { className: 'ccp-start-body' },
                  row('set', 'settings', t.settings, () => onOpenSettings()),
                  row('exp', 'archive', t.export || '导出', () => onExport()),
                  row('cp', 'copy', t.startInsert + ' / ' + t.workspace, () => {
                    try { navigator.clipboard.writeText(cwd || ''); notify(t.saved) } catch (e) { /* ignore */ }
                  }),
                )

      return h('div', { className: 'ccp-start' }, head, body)
    }

    /* ================================================================== CSS */
    const CSS = `
.ccp-root{--bg:${C.bg};--panel:${C.panel};--ink:${C.ink};--ink2:${C.ink2};--line:${C.line};--coral:${C.coral};--coralSoft:${C.coralSoft};--accent:${C.accent};--sel:${C.sel};--clay:${C.clay};
  box-sizing:border-box;height:100%;display:flex;background:var(--bg);color:var(--ink);
  font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif;font-size:13px;line-height:1.55;-webkit-font-smoothing:antialiased}
.ccp-root *{box-sizing:border-box;user-select:text;-webkit-user-select:text}
.ccp-side{width:248px;flex:0 0 248px;border-right:1px solid var(--line);background:var(--panel);display:flex;flex-direction:column;overflow:hidden}
.ccp-side-head{padding:12px 12px 10px;display:flex;align-items:center;gap:8px;border-bottom:1px solid var(--line)}
.ccp-brand{font-size:14px;font-weight:650;letter-spacing:-.01em;white-space:nowrap}
.ccp-lockup{display:inline-flex;align-items:center;min-width:0;flex:0 0 auto}
.ccp-lockup-mark{display:block;object-fit:contain;flex:0 0 auto}
.ccp-lockup-word{font-weight:700;letter-spacing:-.015em;color:var(--ink);white-space:nowrap;line-height:1;overflow:hidden;text-overflow:ellipsis;flex:0 1 auto}
.ccp-lockup-pill{background:var(--clay);color:#fff;font-weight:600;border-radius:999px;white-space:nowrap;line-height:1;letter-spacing:.01em;flex:0 0 auto}
.ccp-lockup-fit{display:flex;flex:0 1 auto;min-width:0;overflow:hidden}
.ccp-new{margin-left:auto;width:28px;height:28px;border:1px solid var(--line);border-radius:7px;background:var(--panel);color:var(--ink);display:flex;align-items:center;justify-content:center;cursor:pointer;flex:0 0 28px}
.ccp-new:hover,.ccp-iconbtn:hover{background:var(--sel)}
.ccp-iconbtn{width:26px;height:26px;border:1px solid transparent;border-radius:6px;background:transparent;color:var(--ink2);display:flex;align-items:center;justify-content:center;cursor:pointer;flex:0 0 26px}
.ccp-search{margin:10px 12px 6px;padding:7px 10px;border:1px solid var(--line);border-radius:7px;background:var(--bg);color:var(--ink);font-size:12px;outline:none;width:calc(100% - 24px)}
.ccp-list{flex:1;overflow-y:auto;padding:4px 8px 16px}
.ccp-item{padding:7px 8px;border-radius:8px;cursor:pointer;display:flex;gap:7px;align-items:flex-start;margin-bottom:2px;border:1px solid transparent;position:relative}
.ccp-item:hover{background:var(--sel)}
.ccp-item.active{background:var(--coralSoft);border-color:var(--coral)}
.ccp-item-title{font-size:12.5px;font-weight:550;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1}
.ccp-item-meta{font-size:10.5px;color:var(--ink2);margin-top:2px}
.ccp-pin{color:var(--coral);display:flex;align-items:center}
.ccp-more{opacity:.35;flex:0 0 auto;padding:2px;border-radius:5px;display:flex;align-items:center}
.ccp-item:hover .ccp-more{opacity:1}
.ccp-more:hover{background:var(--sel);opacity:1}
.ccp-cb{accent-color:var(--coral);margin-top:3px;flex:0 0 auto}
.ccp-batchbar{display:flex;flex-wrap:wrap;gap:5px;padding:7px 10px;border-top:1px solid var(--line);background:var(--coralSoft)}
.ccp-batchbar .ccp-btn{padding:3px 7px;font-size:11px}
.ccp-main{flex:1;min-width:0;display:flex;flex-direction:column;overflow:hidden}
/* Split view. ccp-pane holds the conversation, ccp-pane2 the Start panel;
   the h modifier puts them side by side, v stacks them. */
.ccp-body{flex:1;min-height:0;display:flex;overflow:hidden}
.ccp-body.h{flex-direction:row}
.ccp-body.v{flex-direction:column}
.ccp-pane{flex:1;min-width:0;min-height:0;display:flex;flex-direction:column;overflow:hidden}
.ccp-pane2{flex:0 0 44%;min-width:0;min-height:0;display:flex;flex-direction:column;overflow:hidden;background:var(--panel)}
.ccp-body.h .ccp-pane2{border-left:1px solid var(--line)}
.ccp-body.v .ccp-pane2{flex-basis:46%;border-top:1px solid var(--line)}
.ccp-layouts{display:flex;gap:2px;padding:2px;border:1px solid var(--line);border-radius:7px;background:var(--bg);flex:0 0 auto}
.ccp-layouts button{width:25px;height:21px;display:flex;align-items:center;justify-content:center;border:none;background:transparent;color:var(--ink2);cursor:pointer;border-radius:5px;padding:0}
.ccp-layouts button:hover{background:var(--sel);color:var(--ink)}
.ccp-layouts button.on{background:var(--coralSoft);color:var(--coral)}
.ccp-start{flex:1;min-height:0;display:flex;flex-direction:column;overflow:hidden}
.ccp-start-head{height:40px;flex:0 0 40px;display:flex;align-items:center;gap:8px;padding:0 14px;border-bottom:1px solid var(--line);color:var(--ink2);font-size:12.5px}
.ccp-start-head b{color:var(--ink);font-weight:600}
.ccp-start-body{flex:1;overflow-y:auto;padding:22px 20px 30px}
.ccp-start-hero{display:flex;justify-content:center;padding:14px 0 24px}
.ccp-start-card{display:flex;align-items:center;gap:11px;width:100%;max-width:520px;margin:0 auto 8px;padding:10px 12px;border:1px solid var(--line);border-radius:10px;background:var(--bg);cursor:pointer;text-align:left;color:inherit;font:inherit;transition:border-color .12s,background .12s}
.ccp-start-card:hover{border-color:var(--coral);background:var(--panel)}
.ccp-start-ico{width:28px;height:28px;flex:0 0 28px;border-radius:7px;display:flex;align-items:center;justify-content:center;background:var(--panel);color:var(--coral)}
.ccp-start-t{font-size:12.8px;color:var(--ink);font-weight:500}
.ccp-start-s{font-size:11.3px;color:var(--ink2);margin-top:2px}
.ccp-start-k{margin-left:auto;font-size:11px;color:var(--ink2);white-space:nowrap;flex:0 0 auto}
.ccp-start-bar{display:flex;align-items:center;gap:8px;margin-bottom:10px}
.ccp-start-path{flex:1;min-width:0;font-size:11.5px;color:var(--ink2);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;direction:rtl;text-align:left}
.ccp-start-list{display:flex;flex-direction:column;gap:1px}
.ccp-start-row{display:flex;align-items:center;gap:8px;padding:6px 8px;border-radius:6px;cursor:pointer;font-size:12px;color:var(--ink)}
.ccp-start-row:hover{background:var(--sel)}
.ccp-start-row .nm{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ccp-start-row .mt{font-size:10.5px;color:var(--ink2);flex:0 0 auto}
.ccp-start-pre{flex:1;min-height:120px;max-height:280px;overflow:auto;margin:8px 0 0;padding:9px 10px;border:1px solid var(--line);border-radius:8px;background:var(--bg);font-family:ui-monospace,Consolas,monospace;font-size:11.5px;line-height:1.5;white-space:pre-wrap;word-break:break-word;color:var(--ink)}
.ccp-start-pre.err{color:#c0392b}
.ccp-start-kv{display:grid;grid-template-columns:104px 1fr;gap:5px 10px;font-size:11.8px;line-height:1.55}
.ccp-start-kv dt{color:var(--ink2)}
.ccp-start-kv dd{margin:0;color:var(--ink);word-break:break-all;user-select:text;-webkit-user-select:text}
.ccp-start-sec{margin:14px 0 6px;font-size:11px;color:var(--ink2);text-transform:uppercase;letter-spacing:.04em}
.ccp-bar{height:48px;flex:0 0 48px;border-bottom:1px solid var(--line);display:flex;align-items:center;gap:10px;padding:0 18px;background:var(--panel)}
.ccp-bar-title{font-size:13.5px;font-weight:600;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ccp-chip{padding:4px 9px;border:1px solid var(--line);border-radius:14px;background:var(--bg);color:var(--ink2);font-size:11px;cursor:pointer;display:inline-flex;align-items:center;gap:5px;white-space:nowrap}
.ccp-chip:hover{border-color:var(--coral);color:var(--coral)}
.ccp-wschip{max-width:240px}
.ccp-wschip.on{color:var(--ink)}
.ccp-wschip-t{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:150px}
.ccp-stream{flex:1;overflow-y:auto;padding:22px 26px 40px;display:flex;flex-direction:column}
.ccp-wrap{max-width:880px;margin:0 auto;width:100%;flex:1 0 auto;display:flex;flex-direction:column}
.ccp-welcome{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:20px;text-align:center;color:var(--ink2)}
.ccp-welcome-brand{display:flex;justify-content:center}
.ccp-welcome img{opacity:1}
.ccp-msg{margin-bottom:18px;display:block;user-select:text;-webkit-user-select:text}
.ccp-msg-body{min-width:0;width:100%;user-select:text;-webkit-user-select:text}
.ccp-msg.user .ccp-msg-body{display:block}
.ccp-msg.user .ccp-msg-body{background:var(--coralSoft);border:none;border-radius:8px;padding:12px 16px}
.ccp-readable{user-select:text;-webkit-user-select:text}
.ccp-ts{color:var(--ink2);margin-right:2px}
.ccp-text{background:transparent;border:none;border-radius:0;padding:0;user-select:text;-webkit-user-select:text;overflow-wrap:anywhere}
.ccp-msg.user .ccp-text{background:transparent;border:none;padding:0}
.ccp-text pre{background:var(--bg);border:1px solid var(--line);border-radius:7px;padding:10px;overflow:auto;font-size:12px}
.ccp-text code{font-family:ui-monospace,Consolas,monospace}
.ccp-text table{border-collapse:collapse;margin:8px 0}
.ccp-text td,.ccp-text th{border:1px solid var(--line);padding:4px 8px}
.ccp-fold{border:1px solid var(--line);border-radius:9px;margin:8px 0;background:var(--panel);overflow:hidden}
.ccp-fold-head{padding:7px 11px;display:flex;align-items:center;gap:7px;cursor:pointer;color:var(--ink2);font-size:11.5px;user-select:none}
.ccp-fold-body{padding:9px 12px;border-top:1px solid var(--line);font-size:12px;color:var(--ink2);white-space:pre-wrap;user-select:text;-webkit-user-select:text;max-height:260px;overflow:auto}
.ccp-tool{display:flex;gap:8px;align-items:center;padding:5px 0;font-size:12px}
.ccp-tool-name{color:var(--coral);font-weight:600}
.ccp-work{margin:1px 0}
.ccp-work-row{display:flex;align-items:center;gap:6px;font-size:12px;color:var(--ink2);cursor:pointer;padding:1.5px 0;min-width:0}
.ccp-work-row:hover{color:var(--ink)}
.ccp-work-ico{display:inline-flex;flex:0 0 13px;align-items:center;opacity:.9}
.ccp-work-label{flex:0 0 auto;font-weight:500}
.ccp-work-dot{flex:0 0 auto;opacity:.55}
.ccp-work-sum{flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ccp-work-chev{flex:0 0 auto;opacity:0;transform:rotate(-90deg);transition:opacity .12s,transform .12s;display:inline-flex}
.ccp-work-row:hover .ccp-work-chev{opacity:.6}
.ccp-work-chev.on{opacity:.85;transform:rotate(0)}
.ccp-work-detail{margin:4px 0 8px 19px;padding:8px 10px;background:var(--sel);border-radius:8px;font-size:11.5px;line-height:1.6;color:var(--ink2);white-space:pre-wrap;word-break:break-word;max-height:320px;overflow:auto;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}
.ccp-work-think .ccp-work-label{color:#9c7059}
.ccp-work-think .ccp-work-ico{color:#b47f64}
.ccp-work-tool .ccp-work-label{color:var(--ink2)}
.ccp-foot{display:flex;gap:11px;align-items:center;flex-wrap:wrap;margin-top:5px;font-size:10.5px;color:var(--ink2)}
.ccp-foot-btn{cursor:pointer;display:inline-flex;align-items:center;gap:3px;border:none;background:transparent;padding:0;color:inherit;font:inherit}
.ccp-foot-ico{width:22px;height:22px;border-radius:6px;display:inline-flex;align-items:center;justify-content:center;cursor:pointer;color:var(--ink2);border:none;background:transparent;padding:0}
.ccp-foot-ico:hover{background:var(--sel);color:var(--coral)}
.ccp-foot-btn:hover{color:var(--coral)}
.ccp-respfoot{border-top:1px dashed var(--line);padding-top:6px;margin-top:8px}
.ccp-userfoot{justify-content:flex-end;margin-top:6px}
.ccp-errbox{margin:6px 0;padding:9px 12px;border:1px solid #e3b7ae;background:#fdf1ee;color:#a03d24;border-radius:8px;font-size:12px;line-height:1.6}
.ccp-agent{border:1px solid var(--line);border-left:3px solid var(--coral);border-radius:9px;background:var(--panel);padding:9px 12px;margin:8px 0}
.ccp-agent-h{display:flex;align-items:center;gap:7px;font-size:12px;font-weight:600}
.ccp-agent-task{font-size:11.5px;color:var(--ink2);margin:4px 0 0;white-space:pre-wrap;overflow-wrap:anywhere;max-height:120px;overflow:auto}
.ccp-agent-sub{margin-top:6px;padding-top:5px;border-top:1px dashed var(--line);font-size:10.5px;color:var(--ink2);display:flex;flex-direction:column;gap:3px}
.ccp-appr{border:1px solid var(--coral);background:var(--coralSoft);border-radius:9px;padding:12px 14px;margin:10px 0}
.ccp-appr-h{font-weight:600;color:var(--coral);margin-bottom:6px;display:flex;align-items:center;gap:6px}
.ccp-appr pre{background:rgba(0,0,0,.05);border-radius:6px;padding:8px;font-size:11.5px;max-height:160px;overflow:auto;user-select:text;-webkit-user-select:text}
.ccp-appr-btns{display:flex;gap:8px;margin-top:9px}
.ccp-btn{border:1px solid var(--line);border-radius:7px;padding:6px 13px;background:var(--panel);color:var(--ink);cursor:pointer;font-size:12px;font-family:inherit}
.ccp-btn:hover{border-color:var(--coral)}
.ccp-btn.primary{background:var(--coral);border-color:var(--coral);color:#fff}
.ccp-btn.primary:hover{opacity:.9}
.ccp-btn.ghost{background:transparent}
.ccp-compose{border-top:1px solid var(--line);background:var(--panel);padding:10px 18px 12px}
.ccp-compose-in{max-width:880px;margin:0 auto}
.ccp-box{border:1px solid var(--line);border-radius:11px;background:var(--bg);padding:9px 11px;display:flex;flex-direction:column;gap:7px}
.ccp-box:focus-within{border-color:var(--coral)}
.ccp-box.dragover{border-color:var(--coral);background:var(--coralSoft)}
.ccp-ta{border:none;outline:none;resize:none;background:transparent;color:var(--ink);font-family:inherit;font-size:13px;line-height:1.5;min-height:44px;max-height:180px;overflow-y:auto;width:100%;user-select:text;-webkit-user-select:text}
.ccp-attach{display:flex;flex-wrap:wrap;gap:6px}
.ccp-file{padding:3px 8px;border:1px solid var(--line);border-radius:6px;background:var(--panel);font-size:11px;display:inline-flex;gap:5px;align-items:center;max-width:240px;overflow:hidden;text-overflow:ellipsis}
.ccp-file-x{cursor:pointer;color:var(--ink2);flex:0 0 auto}
.ccp-compose-bar{display:flex;align-items:center;gap:7px;position:relative}
.ccp-mode{padding:3px 9px;border:1px solid var(--line);border-radius:12px;font-size:11px;color:var(--ink2);cursor:pointer;white-space:nowrap}
.ccp-mode:hover{border-color:var(--coral);color:var(--coral)}
.ccp-modelbtn,.ccp-wsbtn{padding:3px 9px;border:1px solid var(--line);border-radius:12px;font-size:11px;color:var(--ink);cursor:pointer;display:inline-flex;align-items:center;gap:5px;background:var(--panel);white-space:nowrap;max-width:230px}
.ccp-modelbtn-t{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0}
.ccp-modelbtn:hover,.ccp-wsbtn:hover{border-color:var(--coral)}
.ccp-modelmenu{min-width:268px;padding:5px}
.ccp-menu-grp{padding:7px 9px 4px;font-size:10px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;color:var(--ink2)}
.ccp-model-i{display:flex;align-items:center;gap:8px;justify-content:space-between}
.ccp-model-name{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ccp-model-id{font-size:10px;color:var(--ink2);font-family:ui-monospace,Consolas,monospace;flex:0 0 auto}
.ccp-ctx-k{color:var(--ink2)}
.ccp-ctx-v{color:var(--ink);font-weight:600}
.ccp-ctx-dot{width:7px;height:7px;border-radius:2px;display:inline-block;margin-right:3px;vertical-align:middle}
.ccp-ctx-dot.in{background:var(--accent)}
.ccp-ctx-dot.out{background:var(--coral)}
.ccp-ctx-sep{width:1px;height:9px;background:var(--line);display:inline-block}
.ccp-ctx-model{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:190px}
.ccp-interject{border:1px solid var(--coral);color:var(--coral);background:var(--coralSoft);border-radius:12px;padding:3px 9px;font-size:11px;cursor:pointer;display:inline-flex;align-items:center;gap:4px;white-space:nowrap}
.ccp-send{margin-left:auto;width:32px;height:32px;border-radius:8px;background:var(--coral);color:#fff;border:none;display:flex;align-items:center;justify-content:center;cursor:pointer;flex:0 0 32px}
.ccp-send:disabled{opacity:.4;cursor:not-allowed}
.ccp-hint{font-size:10.5px;color:var(--ink2);white-space:nowrap}
.ccp-plus{width:30px;height:30px;flex:0 0 30px;border:1px solid var(--line);border-radius:8px;background:var(--panel);color:var(--ink);display:flex;align-items:center;justify-content:center;cursor:pointer;font-size:20px;line-height:1}
.ccp-plus:hover{border-color:var(--coral);color:var(--coral)}
.ccp-plusmenu{min-width:230px}
.ccp-plusmenu .ccp-menu-i{display:flex;align-items:center;gap:9px;padding:9px 11px;font-size:12px}
.ccp-plusmenu .ccp-menu-i:hover{background:var(--sel)}
.ccp-ring{width:22px;height:22px;flex:0 0 22px;cursor:pointer;display:flex;align-items:center;justify-content:center}
.ccp-ctxmodal{width:min(520px,92vw);max-height:86vh;overflow:auto;background:var(--panel);border:1px solid var(--line);border-radius:14px;box-shadow:0 20px 60px rgba(0,0,0,.25)}
.ccp-ctxbig{font-size:30px;font-weight:700;letter-spacing:-.02em;color:var(--ink)}
.ccp-ctxseg{height:9px;border-radius:5px;background:var(--sel);overflow:hidden;display:flex;margin:12px 0}
.ccp-ctxseg span{height:100%;display:block}
.ccp-ctxrow{display:flex;justify-content:space-between;padding:7px 0;border-bottom:1px solid var(--line);font-size:12px}
.ccp-dot{width:8px;height:8px;border-radius:50%;display:inline-block;margin-right:8px}
.ccp-ctx{display:flex;align-items:center;gap:14px;margin-top:8px;font-size:11px;color:var(--ink2)}
.ccp-metric{display:inline-flex;align-items:center;gap:5px;white-space:nowrap;font-variant-numeric:tabular-nums}
.ccp-metric-ctx{cursor:pointer;margin-left:auto}
.ccp-metric-ctx:hover{color:var(--coral)}
.ccp-metric .ccp-ring{width:18px;height:18px;flex:0 0 18px;display:inline-flex;align-items:center;justify-content:center;cursor:pointer}
.ccp-ctx-track{flex:1;height:5px;border-radius:3px;background:var(--sel);overflow:hidden;min-width:40px;display:flex}
.ccp-ctx-fill{height:100%;transition:width .25s}
.ccp-ctx-fill.in{background:var(--accent)}
.ccp-ctx-fill.out{background:var(--coral)}
.ccp-ctx-fill.warn{background:#d97706}
.ccp-menu{position:absolute;bottom:calc(100% + 6px);left:0;min-width:240px;max-height:320px;overflow-y:auto;background:var(--panel);border:1px solid var(--line);border-radius:10px;box-shadow:0 12px 36px rgba(0,0,0,.18);padding:5px;z-index:60}
/* The "+" menu lists 9 rows; give it room so every entry is reachable without scrolling. */
.ccp-menu.ccp-plusmenu{max-height:min(72vh,460px);min-width:250px}
.ccp-menu-i{padding:6px 9px;border-radius:6px;cursor:pointer;font-size:11.5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.ccp-menu-i:hover{background:var(--sel)}
.ccp-menu-i.on{color:var(--coral);background:var(--coralSoft);font-weight:600}
.ccp-menu-sep{height:1px;background:var(--line);margin:4px 2px}
.ccp-scrim{position:fixed;inset:0;background:rgba(0,0,0,.28);display:flex;align-items:center;justify-content:center;z-index:50}
.ccp-modal{width:min(680px,92vw);max-height:86vh;overflow:auto;background:var(--panel);border:1px solid var(--line);border-radius:14px;box-shadow:0 20px 60px rgba(0,0,0,.25)}
.ccp-modal-h{padding:16px 20px;border-bottom:1px solid var(--line);display:flex;align-items:center;gap:9px;position:sticky;top:0;background:var(--panel);z-index:2}
.ccp-modal-t{font-size:15px;font-weight:650;flex:1}
.ccp-modal-b{padding:18px 20px}
.ccp-tabs{display:flex;gap:4px;border-bottom:1px solid var(--line);margin-bottom:14px;flex-wrap:wrap}
.ccp-tab{padding:6px 11px;cursor:pointer;border-radius:7px 7px 0 0;color:var(--ink2);font-size:12px}
.ccp-tab.on{color:var(--coral);border-bottom:2px solid var(--coral);font-weight:600}
.ccp-field{margin-bottom:13px}
.ccp-label{font-size:11.5px;color:var(--ink2);margin-bottom:5px;display:block}
.ccp-input,.ccp-select,.ccp-textarea{width:100%;border:1px solid var(--line);border-radius:7px;padding:7px 10px;background:var(--bg);color:var(--ink);font-family:inherit;font-size:12.5px;outline:none}
.ccp-textarea{min-height:80px;resize:vertical}
.ccp-input:focus,.ccp-select:focus,.ccp-textarea:focus{border-color:var(--coral)}
.ccp-switch{display:flex;align-items:center;gap:8px;cursor:pointer}
.ccp-switch input{accent-color:var(--coral)}
.ccp-actions{display:flex;gap:9px;justify-content:flex-end;padding-top:8px;border-top:1px solid var(--line)}
.ccp-empty{text-align:center;color:var(--ink2);padding:40px 10px}
.ccp-badge{display:inline-flex;align-items:center;gap:4px;padding:2px 7px;border-radius:10px;background:var(--sel);font-size:10.5px;color:var(--ink2)}
.ccp-badge.ok{background:#e6f4ea;color:#1e7e34}
.ccp-badge.bad{background:#fdecea;color:#b3261e}
.ccp-loading{padding:18px 26px;color:var(--ink2);font-size:12px}
`

    /* ============================================== markdown-lite renderer */
    function renderInline(text) {
      return String(text).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]))
    }
    function Markdown({ text }) {
      const lines = String(text || '').split(/\r?\n/)
      const nodes = []
      let i = 0
      let codeBuf = null
      const flushCode = () => {
        if (codeBuf === null) return
        nodes.push(h('pre', { key: 'c' + i }, h('code', { dangerouslySetInnerHTML: { __html: renderInline(codeBuf.join('\n')) } })))
        codeBuf = null
      }
      while (i < lines.length) {
        const line = lines[i]
        if (line.trim().startsWith('```')) {
          if (codeBuf === null) codeBuf = []
          else flushCode()
          i++; continue
        }
        if (codeBuf !== null) { codeBuf.push(line); i++; continue }
        if (/^\s*[-*]\s+/.test(line)) {
          const items = []
          while (i < lines.length && /^\s*[-*]\s+/.test(lines[i])) {
            items.push(h('li', { key: 'li' + i, dangerouslySetInnerHTML: { __html: renderInline(lines[i].replace(/^\s*[-*]\s+/, '')) } }))
            i++
          }
          nodes.push(h('ul', { key: 'ul' + i }, ...items)); continue
        }
        if (/^#{1,6}\s/.test(line)) {
          const m = line.match(/^(#{1,6})\s+(.*)$/)
          nodes.push(h('strong', { key: 'h' + i, style: { fontSize: 14, display: 'block', margin: '6px 0' }, dangerouslySetInnerHTML: { __html: renderInline(m[2]) } }))
          i++; continue
        }
        if (line.trim() === '') { nodes.push(h('div', { key: 'sp' + i, style: { height: 6 } })); i++; continue }
        nodes.push(h('div', { key: 'p' + i, dangerouslySetInnerHTML: { __html: renderInline(line) } }))
        i++
      }
      flushCode()
      return h('div', { className: 'ccp-text' }, ...nodes)
    }

    function groupMessages(messages) {
      const out = []
      for (const m of messages || []) {
        const last = out[out.length - 1]
        if (last && last.role === m.role && m.role === 'assistant' && !m.forceNew) last.items.push(m)
        else out.push({ role: m.role, items: [m], key: m.id || uid() })
      }
      return out
    }

    /** Merge one stream event into a session's local message list. */
    function applyEvent(prev, ev) {
      const next = prev.slice()
      const last = next[next.length - 1]
      if (ev.kind === 'blocks') {
        const text = (ev.blocks || []).filter((b) => b.type === 'text').map((b) => b.text).join('')
        if (last && last.role === 'assistant' && last.streaming) {
          next[next.length - 1] = {
            ...last,
            blocks: [...(last.blocks || []), ...(ev.blocks || [])],
            text: (last.text || '') + text,
          }
        } else {
          next.push({ id: uid(), role: 'assistant', kind: 'blocks', blocks: ev.blocks || [], text, streaming: true })
        }
        return next
      }
      if (ev.kind === 'delta') {
        if (last && last.role === 'assistant' && last.streaming) {
          next[next.length - 1] = { ...last, text: (last.text || '') + (ev.text || '') }
        } else {
          next.push({ id: uid(), role: 'assistant', text: ev.text || '', streaming: true })
        }
        return next
      }
      if (ev.kind === 'thinking') {
        if (last && last.kind === 'thinking' && last.streaming) {
          next[next.length - 1] = { ...last, text: (last.text || '') + (ev.text || '') }
        } else {
          next.push({ id: uid(), role: 'assistant', kind: 'thinking', text: ev.text || '', streaming: true })
        }
        return next
      }
      if (ev.kind === 'result') {
        for (let i = next.length - 1; i >= 0; i--) {
          if (next[i].streaming) { next[i] = { ...next[i], streaming: false }; break }
        }
        next.push({ id: uid(), role: 'assistant', kind: 'result', ...ev })
        return next
      }
      if (ev.kind === 'init') return next
      next.push({ id: ev.id || uid(), role: 'assistant', ...ev, ts: ev.ts || Date.now() })
      return next
    }

    /* =============================================================== main */
    function Panel() {
      const [lang, setLang] = useState(readLang())
      const t = I18N[lang]
      const [view, setView] = useState('chat')
      const [sessions, setSessions] = useState([])
      const [activeId, setActiveId] = useState(null)
      const [messages, setMessages] = useState([])
      const [search, setSearch] = useState('')
      const [input, setInput] = useState('')
      const [files, setFiles] = useState([])
      const [mode, setMode] = useState('acceptEdits')
      const [busy, setBusy] = useState(false)
      const [health, setHealth] = useState(null)
      const [cliInfo, setCliInfo] = useState(null)
      const [modelInfo, setModelInfo] = useState({ models: [], selected: null })
      const [settings, setSettings] = useState(null)
      const [approvals, setApprovals] = useState([])
      const [toast, setToast] = useState('')
      const [confirmAsk, setConfirmAsk] = useState(null)
      const [showTrash, setShowTrash] = useState(false)
      const [modelPicker, setModelPicker] = useState(false)
      const [wsPicker, setWsPicker] = useState(false)
      const [plusMenu, setPlusMenu] = useState(false)
      const [ctxModal, setCtxModal] = useState(false)
      // `single` | `h` (side by side) | `v` (stacked). Persisted so the panel
      // reopens the way it was left.
      const [layout, setLayoutState] = useState(() => {
        try {
          const v = localStorage.getItem('ccp.layout')
          return v === 'h' || v === 'v' ? v : 'single'
        } catch (e) { return 'single' }
      })
      const setLayout = useCallback((v) => {
        setLayoutState(v)
        try { localStorage.setItem('ccp.layout', v) } catch (e) { /* ignore */ }
      }, [])
      // Which card the Start panel shows. Lifted here so the shortcuts below can
      // open a card even when the panel is not mounted yet.
      const [startMode, setStartMode] = useState('home')
      const [workspaces, setWorkspaces] = useState([])
      const [cwd, setCwd] = useState('')
      const [dragover, setDragover] = useState(false)
      const [ctxInfo, setCtxInfo] = useState({ used: 0, inputTokens: 0, outputTokens: 0, session: 0, day: loadDay(), model: '', provider: '', ts: 0, ctxWindow: 0, cacheRead: 0 })
      const [menuFor, setMenuFor] = useState(null)
      const [renameFor, setRenameFor] = useState(null)
      const [groupFor, setGroupFor] = useState(null)
      const [customWs, setCustomWs] = useState(null)
      const [batchMode, setBatchMode] = useState(false)
      const [checked, setChecked] = useState([])

      const streamRef = useRef(null)
      const taRef = useRef(null)
      const pollRef = useRef(null)
      const jobRef = useRef(null)
      const sessionIdRef = useRef(null)
      const activeRef = useRef(activeId)
      const busyRef = useRef(false)
      const inputRef = useRef('')
      const filesRef = useRef([])
      const draftsRef = useRef(loadDrafts())
      const keyRef = useRef(draftKey(null))
      const msgStoreRef = useRef({})
      const dayRef = useRef(loadDay())
      const sessRef = useRef(0)
      activeRef.current = activeId
      busyRef.current = busy

      const notify = useCallback((msg) => {
        setToast(msg)
        setTimeout(() => setToast(''), 2400)
      }, [])

      const persistDraft = useCallback((key) => {
        const d = draftsRef.current
        d[draftKey(key)] = { text: inputRef.current || '', files: filesRef.current || [] }
        draftsRef.current = d
        saveDrafts(d)
      }, [])
      const setInputBoth = useCallback((v) => {
        inputRef.current = v
        setInput(v)
        persistDraft(keyRef.current)
      }, [persistDraft])
      const setFilesBoth = useCallback((arr) => {
        filesRef.current = arr
        setFiles(arr)
        persistDraft(keyRef.current)
      }, [persistDraft])
      const clearDraft = useCallback((key) => {
        const d = draftsRef.current
        d[draftKey(key)] = { text: '', files: [] }
        draftsRef.current = d
        saveDrafts(d)
      }, [])

      // Restores the draft belonging to the initial session on first mount.
      useEffect(() => {
        const d = draftsRef.current[draftKey(activeId)] || {}
        inputRef.current = d.text || ''
        filesRef.current = d.files || []
        setInput(inputRef.current)
        setFiles(filesRef.current)
        keyRef.current = draftKey(activeId)
      }, [])

      useEffect(() => {
        try { localStorage.setItem(LANG_KEY, lang) } catch (e) {}
      }, [lang])

      const refreshSessions = useCallback(async () => {
        try {
          const data = await api('/history')
          setSessions(data.sessions || [])
        } catch (e) { /* backend down */ }
      }, [])

      useEffect(() => {
        api('/health').then(setHealth).catch(() => setHealth(null))
        api('/cli').then(setCliInfo).catch(() => {})
        api('/models').then(setModelInfo).catch(() => {})
        api('/settings').then((d) => {
          setSettings(d.values || {})
          setCwd(d.values?.default_cwd || '')
          if (d.values?.language) setLang(d.values.language)
          if (d.values?.permission_mode) setMode(d.values.permission_mode)
        }).catch(() => {})
        api('/workspaces').then((d) => {
          const list = d.workspaces || []
          setWorkspaces(list)
          // Always surface an active workspace: stored default, else the first real one.
          const preferred = d.defaultCwd || (list[0] && list[0].path) || ''
          setCwd((cur) => cur || preferred)
        }).catch(() => {})
        refreshSessions()
      }, [refreshSessions])

      useEffect(() => {
        const timer = setInterval(async () => {
          try { const data = await api('/approvals'); setApprovals(data.approvals || []) } catch (e) {}
        }, 1200)
        return () => clearInterval(timer)
      }, [])

      const scrollBottom = useCallback(() => {
        setTimeout(() => {
          const el = streamRef.current
          if (el) el.scrollTop = el.scrollHeight
        }, 30)
      }, [])
      useEffect(() => { scrollBottom() }, [messages, scrollBottom])

      /** Apply one real usage report from the bridge. Never invents values. */
      const applyStats = useCallback((ev) => {
        const inputTokens = Number(ev.inputTokens || 0)
        const outputTokens = Number(ev.outputTokens || 0)
        dayRef.current += inputTokens + outputTokens
        sessRef.current += inputTokens + outputTokens
        try { localStorage.setItem(dayKey(), String(dayRef.current)) } catch (e) {}
        setCtxInfo({
          inputTokens,
          outputTokens,
          used: inputTokens + outputTokens,
          session: sessRef.current,
          day: dayRef.current,
          model: ev.model || '',
          provider: ev.provider || '',
          prefillTps: ev.prefillTps,
          decodeTps: ev.decodeTps,
          totalMs: ev.totalMs,
          reasoningChars: ev.reasoningChars || 0,
          stopReason: ev.stopReason || '',
          ts: Date.now(),
        })
      }, [])

      /** Real cache/context numbers, straight from the CLI result usage. */
      const applyResultUsage = useCallback((ev) => {
        const u = ev.usage || {}
        const cacheRead = Number(u.cache_read_input_tokens || 0)
        setCtxInfo((v) => ({
          ...v,
          cacheRead,
          ctxWindow: Number(ev.contextWindow || v.ctxWindow || 0),
          used: Number(u.input_tokens || v.used || 0),
        }))
      }, [])

      /* ---- session switching keeps the unsent draft with its own box ---- */
      const loadSession = useCallback(async (id) => {
        persistDraft(keyRef.current)
        setActiveId(id)
        activeRef.current = id
        keyRef.current = draftKey(id)
        setMenuFor(null)
        sessRef.current = 0
        setCtxInfo((v) => ({ ...v, used: 0, inputTokens: 0, outputTokens: 0, session: 0, ts: 0 }))
        try {
          const data = await api('/history/session?id=' + encodeURIComponent(id))
          // Keep the CLI transcript id in sync with the conversation on screen,
          // otherwise a later turn resumes whichever session was open before.
          sessionIdRef.current = data?.session?.cli_session_id || null
          const loaded = (data.messages || []).map((m) => ({ ...m, id: m.id || uid() }))
          msgStoreRef.current[id] = loaded
          if (activeRef.current === id) setMessages(loaded)
        } catch (e) {
          msgStoreRef.current[id] = []
          if (activeRef.current === id) setMessages([])
        }
        const d = draftsRef.current[draftKey(id)] || {}
        inputRef.current = d.text || ''
        filesRef.current = d.files || []
        setInput(inputRef.current)
        setFiles(filesRef.current)
        setView('chat')
      }, [persistDraft])

      const newSession = useCallback(() => {
        persistDraft(keyRef.current)
        setActiveId(null)
        activeRef.current = null
        // Drop the CLI transcript id too, otherwise the next message keeps
        // resuming the previous conversation instead of starting a new one.
        sessionIdRef.current = null
        keyRef.current = draftKey(null)
        setMessages([])
        setMenuFor(null)
        sessRef.current = 0
        setCtxInfo((v) => ({ ...v, used: 0, inputTokens: 0, outputTokens: 0, session: 0, ts: 0 }))
        setView('chat')
        const d = draftsRef.current[draftKey(null)] || {}
        inputRef.current = d.text || ''
        filesRef.current = d.files || []
        setInput(inputRef.current)
        setFiles(filesRef.current)
      }, [persistDraft])

      /* ---- chat ---- */
      const runChat = useCallback(async (opts) => {
        const { sid, prompt, attachments } = opts
        // Existing sessions resume their Claude CLI transcript so the model
        // keeps context across turns. New sessions start a fresh CLI session.
        const prev = await api('/history/session?id=' + encodeURIComponent(sid)).catch(() => null)
        const resumeId = opts.resumeId || sessionIdRef.current || prev?.session?.cli_session_id || ''
        const uploaded = []
        const failed = []
        for (const att of attachments || []) {
          try {
            uploaded.push(await uploadAttachment(att, sid))
          } catch (e) {
            // Swallowing this was why an attachment could silently vanish and
            // the turn then ran without it.
            failed.push((att.name || '附件') + '：' + (e.message || '上传失败'))
          }
        }
        if (failed.length) notify('附件上传失败 → ' + failed.join('；'))
        if (failed.length && !uploaded.length && (attachments || []).length) {
          throw new Error('附件全部上传失败，已中止本次发送：' + failed.join('；'))
        }
        // Media the CLI cannot read still gets named, but must not be advertised
        // as "read this with Read" — that just makes the model try and fail.
        const fullPrompt = prompt + (uploaded.length
          ? '\n\n' + uploaded.map((u) => {
            const ext = String(u.name || '').toLowerCase().match(/\.([a-z0-9]+)$/)
            const opaque = ext && /^(mp4|mov|mkv|avi|webm|mp3|wav|m4a|flac|ogg|zip|7z|rar|tar|gz)$/.test(ext[1])
            if (opaque) {
              return '@' + u.path + ' （该文件已上传到本机，但本插件无法解析其内容；需要处理请先转成文本或图片）'
            }
            return '@' + u.path + (u.kind === 'doc'
              ? ' （请先用 Read 工具完整读取该文件；二进制文档请先用合适的工具解析）' : '')
          }).join('\n')
          : '')

        const started = await api('/chat', {
          timeout: 90000,
          method: 'POST',
          body: {
            text: fullPrompt,
            session_key: sid,
            model: modelInfo.selected?.model || settings?.model || undefined,
            provider: modelInfo.selected?.provider || settings?.provider || undefined,
            cwd: cwd || settings?.default_cwd || undefined,
            ...(resumeId ? { resume_id: resumeId } : {}),
          },
        })
        const jobId = started.job_id
        jobRef.current = jobId
        let cursor = 0
        // A job whose process dies without writing a result leaves `done` false
        // forever, and the poll loop would keep the input locked with no
        // explanation. Silence for this long means it is not coming back.
        const IDLE_LIMIT = 15 * 60 * 1000
        let lastEventAt = Date.now()
        await new Promise((resolve) => {
          if (pollRef.current) clearInterval(pollRef.current)
          const tick = async () => {
            try {
              const r = await api(`/poll?job_id=${encodeURIComponent(jobId)}&cursor=${cursor}`, { timeout: 30000 })
              cursor = r.cursor
              if (r.events.length) lastEventAt = Date.now()
              else if (!r.done && Date.now() - lastEventAt > IDLE_LIMIT) {
                clearInterval(pollRef.current)
                notify('任务 15 分钟没有任何输出，已停止等待（后台进程可能已退出）')
                resolve()
                return
              }
              if (r.session_id) sessionIdRef.current = r.session_id
              for (const ev of r.events) {
                const cur = msgStoreRef.current[sid] || []
                const next = applyEvent(cur, ev)
                msgStoreRef.current[sid] = next
                if (activeRef.current === sid) setMessages(next)
                if (ev.kind === 'stats') applyStats(ev)
                if (ev.kind === 'result') applyResultUsage(ev)
              }
              scrollBottom()
              if (r.done) {
                // One final drain so events appended right at completion are not lost.
                try {
                  const tail = await api(`/poll?job_id=${encodeURIComponent(jobId)}&cursor=${cursor}`)
                  for (const ev of tail.events) {
                    const cur = msgStoreRef.current[sid] || []
                    const next = applyEvent(cur, ev)
                    msgStoreRef.current[sid] = next
                    if (activeRef.current === sid) setMessages(next)
                    if (ev.kind === 'stats') applyStats(ev)
                    if (ev.kind === 'result') applyResultUsage(ev)
                  }
                  cursor = tail.cursor
                } catch (e) { /* ignore */ }
                if (r.error) notify(t.error + ': ' + r.error)
                clearInterval(pollRef.current)
                resolve()
              }
            } catch (e) {
              clearInterval(pollRef.current)
              resolve()
            }
          }
          // `stream_speed` (0-100) trades smoothness for immediacy: 0 keeps the
          // historic 350 ms cadence, 100 polls as fast as 60 ms.
          const speed = Math.max(0, Math.min(100, Number(settings?.stream_speed) || 0))
          pollRef.current = setInterval(tick, Math.max(60, 350 - Math.round(speed * 2.9)))
          tick()
        })
        jobRef.current = null

        // The reply is already on screen, so release the composer now.
        // Title generation and the history write are bookkeeping: awaiting them
        // kept the send button disabled long after the answer had rendered,
        // which is indistinguishable from "the task never ran".
        void (async () => {
          let title = prompt.replace(/\s+/g, ' ').slice(0, 24) || t.addFile
          if (settings?.auto_title !== false) {
            try {
              // A title is cosmetic; it must never hold the panel hostage.
              const r = await api('/title', { timeout: 15000, method: 'POST', body: { text: prompt.slice(0, 2000) } })
              if (r.title) title = r.title
            } catch (e) { /* fallback title */ }
          }
          await api('/history/save', {
            method: 'POST',
            body: {
              key: sid,
              id: sid,
              title,
              cli_session_id: sessionIdRef.current || prev?.session?.cli_session_id || '',
              messages: msgStoreRef.current[sid] || [],
              created: prev?.session?.created || Date.now(),
              pinned: Boolean(prev?.session?.pinned),
              archived: Boolean(prev?.session?.archived),
              cwd: cwd || settings?.default_cwd || '',
            },
          }).catch(() => {})
          refreshSessions()
        })()
      }, [modelInfo, settings, cwd, notify, refreshSessions, scrollBottom, t])

      const send = useCallback(async (opts = {}) => {
        const raw = opts.text !== undefined ? opts.text : inputRef.current
        const text = String(raw || '').trim()
        const atts = opts.files || filesRef.current || []
        if ((!text && !atts.length) || (busyRef.current && !opts.interject)) return
        const sid = opts.sid || activeId || ('local-' + uid())
        const wasNew = !activeId
        if (!activeId) {
          setActiveId(sid)
          activeRef.current = sid
        }
        keyRef.current = draftKey(sid)
        const userMsg = {
          id: uid(), role: 'user', text: text || t.addFile,
          files: atts.map((f) => ({ name: f.name, kind: f.kind })),
          ts: Date.now(), forceNew: true,
          ...(opts.interject ? { interject: true } : {}),
        }
        const base = msgStoreRef.current[sid] || (activeRef.current === sid ? messages : [])
        msgStoreRef.current[sid] = [...base, userMsg]
        if (activeRef.current === sid) setMessages(msgStoreRef.current[sid])
        clearDraft(sid)
        // A brand-new conversation also leaves a draft under the "new" key —
        // clear it too, otherwise the text reappears on the next new session.
        if (wasNew) clearDraft(null)
        setInputBoth('')
        setFilesBoth([])
        setBusy(true)
        busyRef.current = true
        scrollBottom()
        try {
          await runChat({ sid, prompt: text || t.addFile, attachments: atts, resumeId: opts.resumeId })
        } catch (e) {
          notify(t.connectFail + ': ' + (e.message || ''))
        } finally {
          setBusy(false)
          busyRef.current = false
        }
      }, [activeId, messages, clearDraft, setInputBoth, setFilesBoth, runChat, notify, scrollBottom, t])

      const stop = useCallback(async () => {
        const id = jobRef.current
        if (id) {
          try { await api('/cancel', { method: 'POST', body: { job_id: id } }) } catch (e) {}
        }
        notify(t.stop)
      }, [notify, t])

      const interject = useCallback(async () => {
        const text = inputRef.current.trim()
        if (!text || !busyRef.current) return
        const resumeId = sessionIdRef.current
        const jobId = jobRef.current
        notify(t.interjecting)
        if (jobId) {
          try { await api('/cancel', { method: 'POST', body: { job_id: jobId } }) } catch (e) {}
        }
        // Let the previous job flush its final stream events before resuming.
        await new Promise((r) => setTimeout(r, 500))
        const note = `【插话 · 优先处理】${text}\n\n请在完成上一段尚未执行完的任务后，一并处理这条插话；不要丢弃之前的任务。`
        setBusy(false)
        busyRef.current = false
        await send({ text: note, files: [], resumeId, interject: true, sid: activeRef.current || undefined })
      }, [notify, t, send])

      const onKeyDown = (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault()
          if (busyRef.current) interject()
          else send()
        }
        if (e.key === 'Tab' && e.shiftKey) {
          e.preventDefault()
          const modes = ['acceptEdits', 'auto', 'manual', 'plan', 'dontAsk', 'bypassPermissions']
          const next = modes[(modes.indexOf(mode) + 1) % modes.length]
          setModeAsync(next)
        }
      }

      const addAttachments = useCallback(async (list) => {
        const arr = []
        for (const f of list) {
          const a = await readFileAsAttachment(f)
          if (a) arr.push(a)
        }
        if (arr.length) setFilesBoth([...filesRef.current, ...arr])
      }, [setFilesBoth])

      const onPaste = (e) => {
        const items = Array.from(e.clipboardData?.items || [])
        const dropped = items.filter((it) => it.kind === 'file').map((it) => it.getAsFile()).filter(Boolean)
        if (dropped.length) {
          e.preventDefault()
          addAttachments(dropped)
          return
        }
        const text = e.clipboardData?.getData('text/plain') || ''
        // Long clipboard text becomes a real .txt document attachment so that
        // "paste any document" also covers copied report/table text. The cut-off
        // is the user's `paste_doc_limit` setting.
        const limit = Math.max(1000, Number(settings?.paste_doc_limit) || 10000)
        if (text.length > limit || (text.length > 200 && /[\r\n]/.test(text) && text.length > Math.min(limit, 1500))) {
          e.preventDefault()
          setFilesBoth([...filesRef.current, {
            name: 'pasted-' + new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-') + '.txt',
            kind: 'doc', base64: false, data: text, text: '',
          }])
          notify(t.pasteHint)
        }
      }
      const onDrop = (e) => {
        e.preventDefault()
        setDragover(false)
        const list = Array.from(e.dataTransfer?.files || [])
        if (list.length) addAttachments(list)
      }

      const decideApproval = async (req, decision) => {
        try {
          await api('/approvals/decide', { method: 'POST', body: { job_id: req.jobId, id: req.id, decision } })
          setApprovals((prev) => prev.filter((a) => a.id !== req.id))
        } catch (e) { notify(e.message || '') }
      }

      /* ---- session management ---- */
      const actSession = async (action, s, payload) => {
        setMenuFor(null)
        const targetId = s.id || s.key
        try {
          await api('/history/' + action, {
            method: 'POST',
            body: { id: s.id || s.key, key: s.key, ...(payload || {}) },
          })
          await refreshSessions()
          // Removing the conversation that is currently open must also clear the
          // reading pane, otherwise the deleted thread stays on screen.
          if ((action === 'delete' || action === 'archive' || action === 'purge')
            && activeRef.current === targetId) {
            newSession()
          }
        } catch (e) { notify(e.message || '') }
      }
      const branchSession = async (s) => {
        setMenuFor(null)
        try {
          const d = await api('/history/session?id=' + encodeURIComponent(s.id || s.key))
          const key = 'branch-' + uid()
          await api('/history/save', {
            method: 'POST',
            body: {
              key, id: key, title: (s.title || s.id) + ' · ' + t.branch,
              messages: d.messages || [], created: Date.now(),
            },
          })
          await refreshSessions()
          await loadSession(key)
        } catch (e) { notify(e.message || '') }
      }
      /** Fork the conversation at a given reply into a brand-new session. */
      const branchFromGroup = async (g) => {
        try {
          const all = msgStoreRef.current[activeRef.current] || messages || []
          const at = all.findIndex((m) => (m.id || '') === (g.items?.[0]?.id || ''))
          const cut = at >= 0 ? all.slice(0, at + (g.items?.length || 1)) : all.slice()
          const key = 'branch-' + uid()
          const cur = sessions.find((x) => (x.key || x.id) === activeRef.current)
          const base = (cur && cur.title) || '会话'
          await api('/history/save', {
            method: 'POST',
            body: { key, id: key, title: base + ' · ' + t.branch, messages: cut, created: Date.now() },
          })
          await refreshSessions()
          await loadSession(key)
          notify(t.branchInNew)
        } catch (e) { notify(e.message || '') }
      }
      const batchAction = async (action) => {
        if (action === 'delete') {
          if (!checked.length) return
          setConfirmAsk({
            text: t.confirmBatchDelete + '（' + checked.length + '）',
            run: () => runBatch(action),
          })
          return
        }
        return runBatch(action)
      }
      const runBatch = async (action) => {
        const touchedActive = checked.includes(activeRef.current)
        for (const id of checked) {
          const s = sessions.find((x) => (x.key || x.id) === id) || { id }
          try {
            if (action === 'flags') await actSession('flags', s, { flags: { pinned: true } })
            else await actSession(action, s)
          } catch (e) { /* continue */ }
        }
        setChecked([])
        setBatchMode(false)
        await refreshSessions()
        if (touchedActive && (action === 'delete' || action === 'archive')) newSession()
      }

      const chooseModel = async (m) => {
        try {
          await api('/model/select', { method: 'POST', body: { provider: m.provider, model: m.model } })
          setModelInfo((prev) => ({ ...prev, selected: { provider: m.provider, model: m.model } }))
          setSettings((s) => ({ ...(s || {}), provider: m.provider, model: m.model }))
          setModelPicker(false)
          notify(t.model + ': ' + (m.name || m.model))
        } catch (e) { notify(e.message || '') }
      }
      /** Persist permission mode to settings so the next CLI run uses it. */
      const setModeAsync = async (next) => {
        setMode(next)
        try {
          const values = { ...(settings || {}), permission_mode: next }
          await api('/settings', { method: 'POST', body: values })
          setSettings(values)
          notify(t.permissionMode + ': ' + (t.modeLabels[next] || next))
        } catch (e) { notify(e.message || '') }
      }
      const chooseWorkspace = async (w) => {
        setCwd(w.path)
        setWsPicker(false)
        try {
          const values = { ...(settings || {}), default_cwd: w.path }
          await api('/settings', { method: 'POST', body: values })
          setSettings(values)
        } catch (e) { /* local only */ }
        notify(t.workspace + ': ' + w.path)
      }

      const filtered = sessions.filter((s) => {
        if (showTrash !== Boolean(s.archived)) return false
        if (!search) return true
        return String(s.title || t.branch + ' ' + s.id).toLowerCase().includes(search.toLowerCase())
      })
      // Context gauge: the denominator comes from the CLI's own modelUsage
      // contextWindow. Without it we show the raw count instead of inventing a %.
      const ctxPct = ctxInfo.ctxWindow ? Math.min(1, (ctxInfo.used || 0) / ctxInfo.ctxWindow) : 0
      const ctxPctText = ctxInfo.ctxWindow
        ? Math.round(ctxPct * 100) + '%'
        : fmtTokens(ctxInfo.used || 0)
      const cacheHitText = (() => {
        const c = Number(ctxInfo.cacheRead || 0)
        const i = Number(ctxInfo.inputTokens || 0)
        if (!c && !i) return '—'
        if (!c) return '0%'
        return Math.round((c / (c + i)) * 100) + '%'
      })()
      const agentCount = messages.filter((m) => m.kind === 'agent_start').length
      // Active workspace label — resolved from the real workspace list, never guessed.
      const wsHit = workspaces.find((w) => w.path === cwd)
      const wsLabel = wsHit ? (wsHit.name || cwd.split(/[\\/]/).filter(Boolean).pop()) : (cwd ? cwd.split(/[\\/]/).filter(Boolean).pop() : '')

      // Appearance switches read straight from settings so the panel and the
      // stored values can never disagree.
      const viewPrefs = {
        showThinking: settings?.show_thinking !== false,
        showToolOutput: settings?.show_tool_output !== false,
        transcriptView: settings?.transcript_view || 'verbose',
      }

      // Ctrl+P / Ctrl+` / Ctrl+T open a Start card, matching the hints printed on
      // them. Scoped to focus inside the panel so DSH's own shortcuts elsewhere
      // are untouched.
      useEffect(() => {
        const onKey = (e) => {
          if (!e.ctrlKey || e.altKey || e.metaKey || e.shiftKey) return
          const root = document.querySelector('.ccp-root')
          if (!root || !root.contains(document.activeElement)) return
          const k = String(e.key || '').toLowerCase()
          const openCard = (m) => {
            if (layout === 'single') setLayout('h')
            setStartMode(m)
          }
          if (k === 'p') { e.preventDefault(); openCard('files') }
          else if (k === '`' || e.code === 'Backquote') { e.preventDefault(); openCard('term') }
          else if (k === 't') { e.preventDefault(); openCard('browser') }
        }
        document.addEventListener('keydown', onKey)
        return () => document.removeEventListener('keydown', onKey)
      }, [layout, setLayout])

      // Layout switch: single pane / side by side / stacked. Drawn inline so no
      // icon font is needed and the three states read at a glance.
      const layoutBtn = (key, title, shapes) => h('button', {
        key, title, 'aria-label': title, className: layout === key ? 'on' : '',
        onClick: () => setLayout(key),
      }, h('svg', { width: 14, height: 14, viewBox: '0 0 14 14', fill: 'none', stroke: 'currentColor', strokeWidth: 1.2, 'aria-hidden': true }, ...shapes))

      const layoutButtons = h('div', { className: 'ccp-layouts', title: t.layout },
        layoutBtn('single', t.layoutSingle, [
          h('rect', { x: 1.6, y: 2.6, width: 10.8, height: 8.8, rx: 1.4 }),
        ]),
        layoutBtn('h', t.layoutSplitH, [
          h('rect', { x: 1.6, y: 2.6, width: 10.8, height: 8.8, rx: 1.4 }),
          h('path', { d: 'M7 2.6v8.8' }),
        ]),
        layoutBtn('v', t.layoutSplitV, [
          h('rect', { x: 1.6, y: 2.6, width: 10.8, height: 8.8, rx: 1.4 }),
          h('path', { d: 'M1.6 7h10.8' }),
        ]),
      )

      return h('div', { className: 'ccp-root', style: themeStyle(settings?.theme) },
        /* ---------------- sidebar ---------------- */
        h('div', { className: 'ccp-side' },
          h('div', { className: 'ccp-side-head' },
            h('span', { className: 'ccp-lockup-fit' }, h(BrandLockup, { size: 18, compact: true })),
            h('button', {
              className: 'ccp-iconbtn', title: t.batch,
              style: { marginLeft: 'auto', color: batchMode ? C.coral : C.ink2 },
              onClick: () => { setBatchMode((v) => !v); setChecked([]) },
            }, h(Icon, { name: 'layers', size: 14 })),
            h('button', { className: 'ccp-new', title: t.newSession, onClick: newSession }, h(Icon, { name: 'plus', size: 15 })),
          ),
          h('input', { className: 'ccp-search', placeholder: t.search, value: search, onChange: (e) => setSearch(e.target.value) }),
          h('div', { className: 'ccp-list' },
            ...filtered.map((s) => {
              const key = s.key || s.id
              return h('div', {
                key,
                className: 'ccp-item' + (activeId === key ? ' active' : ''),
                onClick: () => { if (batchMode) setChecked((p) => p.includes(key) ? p.filter((x) => x !== key) : [...p, key]); else loadSession(key) },
                onContextMenu: (e) => { e.preventDefault(); setMenuFor({ id: key, x: e.clientX, y: e.clientY, session: s }) },
              },
                batchMode ? h('input', {
                  type: 'checkbox', className: 'ccp-cb', checked: checked.includes(key),
                  onClick: (e) => e.stopPropagation(),
                  onChange: () => setChecked((p) => p.includes(key) ? p.filter((x) => x !== key) : [...p, key]),
                }) : null,
                s.pinned ? h('span', { className: 'ccp-pin' }, h(Icon, { name: 'pin', size: 12 })) : null,
                h('div', { style: { flex: 1, minWidth: 0 } },
                  h('div', { className: 'ccp-item-title', title: s.title || s.id }, s.title || s.id),
                  h('div', { className: 'ccp-item-meta' }, fmtTime(s.updated) + (s.source === 'cli' ? ' · CLI' : '') + (s.group ? ' · ' + s.group : '')),
                ),
                !batchMode ? h('span', {
                  className: 'ccp-more', title: '…',
                  onClick: (e) => { e.stopPropagation(); const r = e.currentTarget.getBoundingClientRect(); setMenuFor({ id: key, x: r.left, y: r.bottom + 4, session: s }) },
                }, h(Icon, { name: 'more', size: 14 })) : null,
              )
            }),
            !filtered.length ? h('div', { className: 'ccp-empty' }, t.noSessions) : null,
          ),
          batchMode ? h('div', { className: 'ccp-batchbar' },
            h('button', { className: 'ccp-btn ghost', onClick: () => setChecked(checked.length === filtered.length ? [] : filtered.map((s) => s.key || s.id)) }, t.selectAll),
            h('button', { className: 'ccp-btn ghost', onClick: () => batchAction('flags') }, t.batchPin),
            h('button', { className: 'ccp-btn ghost', onClick: () => batchAction('archive') }, t.batchArchive),
            h('button', { className: 'ccp-btn ghost', onClick: () => batchAction('delete') }, t.batchDelete),
            h('button', { className: 'ccp-btn ghost', onClick: () => { setBatchMode(false); setChecked([]) } }, t.cancelBatch),
          ) : null,
          h('div', { style: { padding: '8px 10px', borderTop: '1px solid var(--line)', display: 'flex', gap: 6 } },
            h('button', { className: 'ccp-btn ghost', style: { flex: 1 }, onClick: () => setShowTrash((v) => !v) }, showTrash ? t.back : t.trash),
            h('button', { className: 'ccp-btn ghost', onClick: () => setView('settings'), title: t.settings }, h(Icon, { name: 'settings', size: 15 })),
          ),
        ),

        /* ---------------- main ---------------- */
        h('div', { className: 'ccp-main' },
          h('div', { className: 'ccp-bar' },
            h('div', { className: 'ccp-bar-title' },
              view === 'settings' ? t.settings : (sessions.find((s) => (s.key || s.id) === activeId)?.title || t.newSession)),
            agentCount ? h('span', { className: 'ccp-badge' }, h(Icon, { name: 'branch', size: 11 }), agentCount + ' ' + t.agent) : null,
            h('div', { style: { position: 'relative' } },
              h('span', {
                className: 'ccp-chip ccp-wschip' + (cwd ? ' on' : ''),
                title: cwd || t.workspace,
                onClick: () => { setWsPicker((v) => !v); setModelPicker(false); setPlusMenu(false) },
              },
                h(Icon, { name: 'folder', size: 12 }),
                h('span', { className: 'ccp-wschip-t' }, wsLabel || t.workspace),
                h(Icon, { name: 'chevron', size: 11 }),
              ),
              wsPicker ? h('div', { className: 'ccp-menu', style: { left: 'auto', right: 0, top: 'calc(100% + 6px)', bottom: 'auto', minWidth: 300 } },
                h('div', { className: 'ccp-menu-grp' }, t.workspace),
                ...workspaces.map((w, i) => h('div', {
                  key: i, className: 'ccp-menu-i ccp-model-i' + (w.path === cwd ? ' on' : ''), title: w.path,
                  onClick: () => chooseWorkspace(w),
                },
                  h('span', { className: 'ccp-model-name' }, (w.path === cwd ? '✓ ' : '') + (w.name || w.path)),
                  h('span', { className: 'ccp-model-id' }, w.path),
                )),
                !workspaces.length ? h('div', { className: 'ccp-menu-i' }, t.loading) : null,
                h('div', { className: 'ccp-menu-sep' }),
                h('div', { className: 'ccp-menu-i', onClick: () => { setWsPicker(false); setCustomWs(cwd || '') } }, t.customWorkspace),
              ) : null,
            ),
            cliInfo ? h('span', { className: 'ccp-badge ' + (cliInfo.ok ? 'ok' : 'bad') }, cliInfo.ok ? t.cliReady : t.cliMissing) : null,
            layoutButtons,
            h('span', { className: 'ccp-chip', onClick: () => setLang((v) => (v === 'zh' ? 'en' : 'zh')) }, lang === 'zh' ? '中文' : 'EN'),
          ),

          h('div', { className: 'ccp-body ' + (layout === 'v' ? 'v' : 'h') },
            h('div', { className: 'ccp-pane' },
              view === 'settings'
                ? h(SettingsView, {
                  t, lang, setLang, settings, setSettings, api, notify,
                  modelInfo, setModelInfo, cliInfo, setCliInfo, health, cwd, setCwd,
                })
                : h(React.Fragment, {},
              h('div', { className: 'ccp-stream', ref: streamRef },
                h('div', { className: 'ccp-wrap' },
                  !messages.length ? h('div', { className: 'ccp-welcome' },
                    h('div', { className: 'ccp-welcome-brand' }, h(BrandLockup, { size: 44 })),
                  ) : null,
                  ...groupMessages(messages).map((g) => renderGroup(g, t, notify, approvals, decideApproval, messages, branchFromGroup, viewPrefs)),
                  busy ? h('div', { className: 'ccp-loading' }, t.loading + ' …') : null,
                ),
              ),
              h('div', { className: 'ccp-compose' },
                h('div', { className: 'ccp-compose-in' },
                  h('div', {
                    className: 'ccp-box' + (dragover ? ' dragover' : ''),
                    onDragOver: (e) => { e.preventDefault(); setDragover(true) },
                    onDragLeave: () => setDragover(false),
                    onDrop,
                  },
                    files.length ? h('div', { className: 'ccp-attach' },
                      ...files.map((f, i) => h('span', { className: 'ccp-file', key: i, title: f.name },
                        h(Icon, { name: 'paperclip', size: 11 }), f.name,
                        h('span', { className: 'ccp-file-x', onClick: () => setFilesBoth(filesRef.current.filter((_, j) => j !== i)) }, '×'),
                      )),
                    ) : null,
                    h('textarea', {
                      ref: taRef, className: 'ccp-ta', placeholder: t.placeholder,
                      value: input, rows: 2,
                      onChange: (e) => {
                        setInputBoth(e.target.value)
                        const el = e.target
                        el.style.height = 'auto'
                        el.style.height = Math.min(180, el.scrollHeight) + 'px'
                      },
                      onKeyDown, onPaste,
                    }),
                    h('div', { className: 'ccp-compose-bar' },
                      h('div', { style: { position: 'relative' } },
                        h('button', {
                          className: 'ccp-plus', title: t.addFile,
                          onClick: () => { setPlusMenu((v) => !v); setModelPicker(false); setWsPicker(false) },
                        }, '+'),
                        plusMenu ? h('div', { className: 'ccp-menu ccp-plusmenu' },
                          h('label', { className: 'ccp-menu-i' },
                            h(Icon, { name: 'paperclip', size: 14 }), t.addFile,
                            h('input', { type: 'file', multiple: true, style: { display: 'none' }, onChange: (e) => { addAttachments(Array.from(e.target.files || [])); e.target.value = ''; setPlusMenu(false) } }),
                          ),
                          h('div', { className: 'ccp-menu-sep' }),
                          h('div', { className: 'ccp-menu-i', onClick: () => { setPlusMenu(false); setWsPicker(true) } },
                            h(Icon, { name: 'folder', size: 14 }), t.workspace + (wsLabel ? ' · ' + wsLabel : ''),
                          ),
                          h('div', { className: 'ccp-menu-sep' }),
                          h('div', { className: 'ccp-menu-grp' }, t.permissionMode),
                          // Exact values accepted by `claude --permission-mode`, shown in Chinese.
                          ...['acceptEdits', 'auto', 'manual', 'plan', 'dontAsk', 'bypassPermissions'].map((mo) =>
                            h('div', {
                              key: mo,
                              className: 'ccp-menu-i ccp-model-i' + (mode === mo ? ' on' : ''),
                              onClick: () => { setModeAsync(mo); setPlusMenu(false) },
                            },
                              h('span', { className: 'ccp-model-name' }, (mode === mo ? '✓ ' : '') + (t.modeLabels[mo] || mo)),
                              h('span', { className: 'ccp-model-id' }, mo),
                            )),
                          h('div', { className: 'ccp-menu-sep' }),
                          h('div', { className: 'ccp-menu-i', onClick: () => { setPlusMenu(false); setView('settings') } },
                            h(Icon, { name: 'settings', size: 14 }), t.settings,
                          ),
                        ) : null,
                      ),
                      // Workspace switching lives in the top bar; the "+" entry just opens it there.
                      busy && input.trim() ? h('button', { className: 'ccp-interject', onClick: interject }, h(Icon, { name: 'bolt', size: 12 }), t.interject) : null,
                      h('span', { style: { flex: 1 } }),
                      h('div', { className: 'ccp-ring', title: t.ctxTitle + ' · ' + fmtTokens(ctxInfo.used) + ' token', onClick: () => setCtxModal(true) },
                        (() => {
                          const R = 8.5
                          const CIRC = 2 * Math.PI * R
                          const total = (ctxInfo.inputTokens || 0) + (ctxInfo.outputTokens || 0)
                          if (!total) {
                            return h('svg', { width: 22, height: 22, viewBox: '0 0 22 22' },
                              h('circle', { cx: 11, cy: 11, r: R, fill: 'none', stroke: C.line, strokeWidth: 2.2 }))
                          }
                          const inLen = CIRC * (ctxInfo.inputTokens / total)
                          const outLen = CIRC - inLen
                          return h('svg', { width: 22, height: 22, viewBox: '0 0 22 22' },
                            h('circle', {
                              cx: 11, cy: 11, r: R, fill: 'none', stroke: C.accent, strokeWidth: 2.2,
                              strokeDasharray: inLen.toFixed(2) + ' ' + (CIRC - inLen).toFixed(2),
                              transform: 'rotate(-90 11 11)',
                            }),
                            h('circle', {
                              cx: 11, cy: 11, r: R, fill: 'none', stroke: C.coral, strokeWidth: 2.2,
                              strokeDasharray: outLen.toFixed(2) + ' ' + (CIRC - outLen).toFixed(2),
                              strokeDashoffset: (-inLen).toFixed(2),
                              transform: 'rotate(-90 11 11)',
                            }),
                          )
                        })(),
                      ),
                      h('div', { style: { position: 'relative' } },
                        h('button', {
                          className: 'ccp-modelbtn',
                          onClick: () => { setModelPicker((v) => !v); setWsPicker(false); setPlusMenu(false) },
                          title: modelInfo.selected ? (providerLabel(modelInfo, modelInfo.selected.provider) + ' / ' + modelLabel(modelInfo, settings)) : t.model,
                        }, h(Icon, { name: 'cube', size: 12 }), h('span', { className: 'ccp-modelbtn-t' }, shortModel(modelInfo, settings)), h(Icon, { name: 'chevron', size: 11 })),
                        modelPicker ? h('div', { className: 'ccp-menu ccp-modelmenu', style: { left: 'auto', right: 0 } },
                          ...(modelInfo.models || []).map((m, i) => {
                            const on = modelInfo.selected && modelInfo.selected.provider === m.provider && modelInfo.selected.model === m.model
                            const prev = i > 0 ? modelInfo.models[i - 1] : null
                            const newGroup = !prev || prev.provider !== m.provider
                            return h(React.Fragment, { key: i },
                              newGroup ? h('div', { className: 'ccp-menu-grp' }, m.providerName || m.provider) : null,
                              h('div', {
                                className: 'ccp-menu-i ccp-model-i' + (on ? ' on' : ''),
                                onClick: () => chooseModel(m),
                              },
                                h('span', { className: 'ccp-model-name' }, (on ? '✓ ' : '') + (m.name || m.model)),
                                h('span', { className: 'ccp-model-id' }, m.model),
                              ),
                            )
                          }),
                          !(modelInfo.models || []).length ? h('div', { className: 'ccp-menu-i' }, t.loading) : null,
                        ) : null,
                      ),
                      h('button', {
                        className: 'ccp-send', disabled: busy || (!input.trim() && !files.length),
                        onClick: busy ? stop : send, title: busy ? t.stop : t.send,
                      }, h(Icon, { name: busy ? 'stop' : 'send', size: 16, color: '#fff' })),
                    ),
                  ),
                  h('div', { className: 'ccp-ctx' },
                    h('span', { className: 'ccp-metric', title: t.decode + '（最近一轮实测）' },
                      h(Icon, { name: 'speed', size: 12 }),
                      h('span', {}, fmtTps(ctxInfo.decodeTps)),
                    ),
                    h('span', { className: 'ccp-metric', title: '缓存命中率（来自 CLI 返回的 usage）' },
                      h(Icon, { name: 'cache', size: 12 }),
                      h('span', {}, '缓存命中 ' + cacheHitText),
                    ),
                    h('span', {
                      className: 'ccp-metric ccp-metric-ctx', title: t.ctxTitle,
                      onClick: () => setCtxModal(true),
                    },
                      h('span', { className: 'ccp-ring', 'aria-hidden': true },
                        (() => {
                          const p = ctxPct
                          const R = 7
                          const cir = 2 * Math.PI * R
                          return h('svg', { width: 18, height: 18, viewBox: '0 0 18 18' },
                            h('circle', { cx: 9, cy: 9, r: R, fill: 'none', stroke: C.line, strokeWidth: 2.4 }),
                            h('circle', {
                              cx: 9, cy: 9, r: R, fill: 'none', stroke: C.coral, strokeWidth: 2.4,
                              strokeLinecap: 'round', strokeDasharray: cir,
                              strokeDashoffset: cir * (1 - Math.max(0, Math.min(1, p))),
                              transform: 'rotate(-90 9 9)',
                            }),
                          )
                        })(),
                      ),
                      h('span', {}, ctxPctText),
                    ),
                  ),
                ),
              ),
            ),
              ),
              layout !== 'single'
                ? h('div', { className: 'ccp-pane2' },
                  h(StartPanel, {
                    t, cwd, notify,
                    mode: startMode,
                    setMode: setStartMode,
                    onInsert: (text) => setInputBoth((inputRef.current || '') + text),
                    onOpenSettings: () => setView('settings'),
                    onExport: () => refreshSessions(),
                  }),
                )
                : null,
            ),
        ),

        ctxModal ? h('div', { className: 'ccp-scrim', onClick: () => setCtxModal(false) },
          h('div', { className: 'ccp-ctxmodal', onClick: (e) => e.stopPropagation() },
            h('div', { className: 'ccp-modal-h' },
              h('span', { className: 'ccp-modal-t' }, t.ctxTitle),
              h('span', { className: 'ccp-iconbtn', onClick: () => setCtxModal(false) }, h(Icon, { name: 'x', size: 15 })),
            ),
            h('div', { className: 'ccp-modal-b' },
              h('div', { className: 'ccp-ctxbig' }, fmtTokens(ctxInfo.used) + ' token'),
              h('div', { style: { color: C.ink2, marginTop: 4 } },
                t.ctxUsed + ' · ' + modelLabel(modelInfo, { model: ctxInfo.model || settings?.model })),
              h('div', { className: 'ccp-ctxseg' },
                (() => {
                  const total = (ctxInfo.inputTokens || 0) + (ctxInfo.outputTokens || 0)
                  if (!total) return h('span', { style: { width: '100%', background: C.sel } })
                  return h(React.Fragment, {},
                    h('span', { style: { width: (ctxInfo.inputTokens / total * 100).toFixed(1) + '%', background: C.accent } }),
                    h('span', { style: { width: (ctxInfo.outputTokens / total * 100).toFixed(1) + '%', background: C.coral } }),
                  )
                })(),
              ),
              h('div', { className: 'ccp-ctxrow' }, h('span', {}, h('i', { className: 'ccp-ctx-dot in' }), '输入 token（本轮实测）'), h('strong', {}, fmtTokens(ctxInfo.inputTokens))),
              h('div', { className: 'ccp-ctxrow' }, h('span', {}, h('i', { className: 'ccp-ctx-dot out' }), '输出 token（本轮实测）'), h('strong', {}, fmtTokens(ctxInfo.outputTokens))),
              h('div', { className: 'ccp-ctxrow' }, h('span', {}, t.prefill), h('strong', {}, fmtTps(ctxInfo.prefillTps))),
              h('div', { className: 'ccp-ctxrow' }, h('span', {}, t.decode), h('strong', {}, fmtTps(ctxInfo.decodeTps))),
              h('div', { className: 'ccp-ctxrow' }, h('span', {}, '推理字符'), h('strong', {}, String(ctxInfo.reasoningChars || 0))),
              h('div', { className: 'ccp-ctxrow' }, h('span', {}, t.duration), h('strong', {}, ctxInfo.totalMs ? (ctxInfo.totalMs / 1000).toFixed(2) + 's' : '-')),
              h('div', { className: 'ccp-ctxrow' }, h('span', {}, '提供方 / 模型'),
                h('strong', {}, providerLabel(modelInfo, ctxInfo.provider) + ' / ' + modelLabel(modelInfo, { model: ctxInfo.model || settings?.model }))),
              h('div', { className: 'ccp-ctxrow' }, h('span', {}, t.stopReason), h('strong', {}, ctxInfo.stopReason || '-')),
              h('div', { className: 'ccp-ctxrow' }, h('span', {}, '本会话累计'), h('strong', {}, fmtTokens(ctxInfo.session))),
              h('div', { className: 'ccp-ctxrow' }, h('span', {}, t.today + ' 累计'), h('strong', {}, fmtTokens(ctxInfo.day))),
              h('div', { className: 'ccp-hint', style: { marginTop: 12, whiteSpace: 'normal' } },
                '以上数值全部来自 DSH 协议桥返回的真实 usage；DSH 未提供模型上下文窗口上限，因此这里不显示百分比，也不做任何推测。'),
            ),
          ),
        ) : null,

        /* ---- session context menu ---- */
        menuFor ? h('div', { className: 'ccp-menu', style: { position: 'fixed', bottom: 'auto', top: menuFor.y, left: Math.min(menuFor.x, window.innerWidth - 260), zIndex: 80 } },
          h('div', { className: 'ccp-menu-i', onClick: () => { setRenameFor({ id: menuFor.id, value: menuFor.session.title || '' }); setMenuFor(null) } }, h(Icon, { name: 'edit', size: 12 }), ' ' + t.rename),
          h('div', { className: 'ccp-menu-i', onClick: () => actSession('flags', menuFor.session, { flags: { pinned: !menuFor.session.pinned } }) }, h(Icon, { name: 'pin', size: 12 }), ' ' + (menuFor.session.pinned ? t.unpin : t.pin)),
          h('div', { className: 'ccp-menu-i', onClick: () => actSession(menuFor.session.archived ? 'restore' : 'archive', menuFor.session) }, h(Icon, { name: 'archive', size: 12 }), ' ' + (menuFor.session.archived ? t.restore : t.archive)),
          h('div', { className: 'ccp-menu-i', onClick: () => branchSession(menuFor.session) }, h(Icon, { name: 'branch', size: 12 }), ' ' + t.branch),
          h('div', { className: 'ccp-menu-i', onClick: () => { copyText(String(menuFor.session.cli_session_id || menuFor.session.id)); setMenuFor(null); notify(t.copied) } }, h(Icon, { name: 'copy', size: 12 }), ' ' + t.copyId),
          h('div', { className: 'ccp-menu-i', onClick: () => { setGroupFor({ id: menuFor.id, value: menuFor.session.group || '' }); setMenuFor(null) } }, h(Icon, { name: 'layers', size: 12 }), ' ' + t.group),
          h('div', { className: 'ccp-menu-sep' }),
          h('div', { className: 'ccp-menu-i', style: { color: '#b3261e' }, onClick: () => { const s = menuFor.session; setMenuFor(null); setConfirmAsk({ text: t.confirmDelete, run: () => actSession('delete', s) }) } }, h(Icon, { name: 'trash', size: 12 }), ' ' + t.remove),
        ) : null,

        renameFor ? h('div', { className: 'ccp-scrim', onClick: () => setRenameFor(null) },
          h('div', { className: 'ccp-modal', style: { width: 420 }, onClick: (e) => e.stopPropagation() },
            h('div', { className: 'ccp-modal-h' }, h('span', { className: 'ccp-modal-t' }, t.rename), h('span', { className: 'ccp-iconbtn', onClick: () => setRenameFor(null) }, h(Icon, { name: 'x', size: 14 }))),
            h('div', { className: 'ccp-modal-b' },
              h('input', { className: 'ccp-input', autoFocus: true, value: renameFor.value, onChange: (e) => setRenameFor((r) => ({ ...r, value: e.target.value })), onKeyDown: (e) => { if (e.key === 'Enter') { actSession('rename', { id: renameFor.id }, { title: renameFor.value }); setRenameFor(null) } } }),
              h('div', { className: 'ccp-actions', style: { marginTop: 14 } },
                h('button', { className: 'ccp-btn ghost', onClick: () => setRenameFor(null) }, t.cancelBatch),
                h('button', { className: 'ccp-btn primary', onClick: () => { actSession('rename', { id: renameFor.id }, { title: renameFor.value }); setRenameFor(null) } }, t.save),
              ),
            ),
          ),
        ) : null,

        groupFor ? h('div', { className: 'ccp-scrim', onClick: () => setGroupFor(null) },
          h('div', { className: 'ccp-modal', style: { width: 420 }, onClick: (e) => e.stopPropagation() },
            h('div', { className: 'ccp-modal-h' }, h('span', { className: 'ccp-modal-t' }, t.group), h('span', { className: 'ccp-iconbtn', onClick: () => setGroupFor(null) }, h(Icon, { name: 'x', size: 14 }))),
            h('div', { className: 'ccp-modal-b' },
              h('input', { className: 'ccp-input', autoFocus: true, placeholder: t.groupName, value: groupFor.value, onChange: (e) => setGroupFor((r) => ({ ...r, value: e.target.value })) }),
              h('div', { className: 'ccp-actions', style: { marginTop: 14 } },
                h('button', { className: 'ccp-btn ghost', onClick: () => setGroupFor(null) }, t.cancelBatch),
                h('button', { className: 'ccp-btn primary', onClick: () => { actSession('move', { id: groupFor.id }, { project: groupFor.value }); setGroupFor(null) } }, t.save),
              ),
            ),
          ),
        ) : null,

        customWs ? h('div', { className: 'ccp-scrim', onClick: () => setCustomWs(null) },
          h('div', { className: 'ccp-modal', style: { width: 520 }, onClick: (e) => e.stopPropagation() },
            h('div', { className: 'ccp-modal-h' }, h('span', { className: 'ccp-modal-t' }, t.customWorkspace), h('span', { className: 'ccp-iconbtn', onClick: () => setCustomWs(null) }, h(Icon, { name: 'x', size: 14 }))),
            h('div', { className: 'ccp-modal-b' },
              h('input', { className: 'ccp-input', autoFocus: true, value: customWs, onChange: (e) => setCustomWs(e.target.value) }),
              h('div', { className: 'ccp-actions', style: { marginTop: 14 } },
                h('button', { className: 'ccp-btn ghost', onClick: () => setCustomWs(null) }, t.cancelBatch),
                h('button', { className: 'ccp-btn primary', onClick: () => { if (customWs.trim()) chooseWorkspace({ path: customWs.trim(), name: customWs.trim().split(/[\\/]/).pop() }); setCustomWs(null) } }, t.save),
              ),
            ),
          ),
        ) : null,

        confirmAsk ? h('div', { className: 'ccp-scrim', onClick: () => setConfirmAsk(null) },
          h('div', { className: 'ccp-modal', style: { width: 420 }, onClick: (e) => e.stopPropagation() },
            h('div', { className: 'ccp-modal-h' },
              h('span', { className: 'ccp-modal-t' }, t.confirmTitle),
              h('span', { className: 'ccp-iconbtn', onClick: () => setConfirmAsk(null) }, h(Icon, { name: 'x', size: 14 })),
            ),
            h('div', { className: 'ccp-modal-b' },
              h('div', { style: { fontSize: 12.5, lineHeight: 1.7, color: C.ink2 } }, confirmAsk.text),
              h('div', { className: 'ccp-actions', style: { marginTop: 14 } },
                h('button', { className: 'ccp-btn ghost', onClick: () => setConfirmAsk(null) }, t.cancelBatch),
                h('button', {
                  className: 'ccp-btn primary',
                  style: { background: '#b3261e' },
                  onClick: () => { const f = confirmAsk.run; setConfirmAsk(null); f && f() },
                }, t.confirm),
              ),
            ),
          ),
        ) : null,

        toast ? h('div', {
          style: { position: 'fixed', bottom: 24, left: '50%', transform: 'translateX(-50%)', background: C.ink, color: C.bg, padding: '8px 16px', borderRadius: 8, fontSize: 12, zIndex: 100 },
        }, toast) : null,
      )
    }

    /* =========================================================== rendering */
    function groupText(items) {
      return items.map((m) => {
        if (m.kind === 'blocks' || (m.blocks && m.blocks.length)) {
          return (m.blocks || []).filter((b) => b.type === 'text').map((b) => b.text).join('')
        }
        if (m.kind === 'result' || m.kind === 'stats' || m.kind === 'agent_start') return ''
        return m.text || ''
      }).filter(Boolean).join('\n')
    }

    function renderGroup(g, t, notify, approvals, decideApproval, all, onBranch, prefs) {
      const isUser = g.role === 'user'
      const stats = isUser ? null : [...g.items].reverse().find((m) => m.kind === 'stats')
      const result = isUser ? null : [...g.items].reverse().find((m) => m.kind === 'result')
      const text = groupText(g.items)
      const ts = (g.items.find((m) => m.ts)?.ts) || (isUser ? stats?.ts : result?.ts)
      // A provider-side failure must never be shown as a successful turn.
      const failed = !isUser && ((stats && stats.stopReason === 'error') || (result && result.ok === false))
      // One copy control per message group, rendered outside the body so the
      // user block stays a clean band and nothing is duplicated.
      const foot = h('div', { className: 'ccp-foot' + (isUser ? ' ccp-userfoot' : ' ccp-respfoot') },
        !isUser && stats ? h(React.Fragment, { key: 'st' },
          h('span', {}, t.prefill + ': ' + fmtTps(stats.prefillTps)),
          h('span', {}, t.decode + ': ' + fmtTps(stats.decodeTps)),
          h('span', {}, stats.provider ? stats.provider + '/' + (stats.model || '-') : (stats.model || '-')),
        ) : null,
        !isUser && result ? h('span', { key: 'rs', className: 'ccp-badge ' + ((result.ok && !failed) ? 'ok' : 'bad') }, (result.ok && !failed) ? t.result : t.error) : null,
        !isUser && result?.duration_ms ? h('span', { key: 'du' }, t.duration + ' ' + Math.round(result.duration_ms / 1000) + 's') : null,
        ts ? h('span', { key: 'ts', className: 'ccp-ts' }, fmtTime(ts)) : null,
        text ? h('button', {
          key: 'cp', className: 'ccp-foot-ico', title: t.copy,
          onClick: () => { copyText(text); notify(t.copied) },
        }, h(Icon, { name: 'copy', size: 13 })) : null,
        !isUser && onBranch ? h('button', {
          key: 'br', className: 'ccp-foot-ico', title: t.branchInNew,
          onClick: () => onBranch(g),
        }, h(Icon, { name: 'branch', size: 13 })) : null,
      )
      return h('div', { className: 'ccp-msg ' + (isUser ? 'user' : ''), key: g.key },
        h('div', { className: 'ccp-msg-body' },
          ...g.items.map((m, idx) => renderMessage(m, t, notify, idx, approvals, decideApproval, all, prefs)),
          failed ? h('div', { className: 'ccp-errbox' },
            '本轮未返回内容：' + (stats ? (stats.provider || '-') + ' / ' + (stats.model || '-') : '-') +
            (stats?.failure ? ' · ' + stats.failure : (result?.error ? ' · ' + result.error : ' 返回 error')) +
            '。请先检查该提供方的凭据/额度，或在右下角切换模型；若该会话反复失败，请新建会话后再试（旧会话的 CLI 记录可能已损坏）。',
          ) : null,
        ),
        foot,
      )
    }

    /** Map a CLI tool name to a Chinese verb + icon (mirrors Claude Code's own log). */
    function toolMeta(name) {
      const n = String(name || '').toLowerCase()
      if (n === 'bash' || n === 'pwsh' || n === 'shell' || n.startsWith('pow')) return { icon: 'terminal', label: '运行命令' }
      if (n === 'read') return { icon: 'read', label: '读取' }
      if (n === 'write' || n === 'edit' || n === 'notebookedit' || n === 'multiedit') return { icon: 'write', label: '写入' }
      if (n === 'grep' || n === 'glob') return { icon: 'search', label: '搜索' }
      if (n === 'webfetch' || n === 'websearch') return { icon: 'search', label: '联网' }
      if (n === 'task' || n === 'agent') return { icon: 'agent', label: '子代理' }
      return { icon: 'cube', label: name || '工具' }
    }

    function toolSummary(m) {
      const i = m.input || {}
      const pick = i.file_path || i.path || i.command || i.pattern || i.query || i.url
        || i.description || i.prompt || i.task || ''
      const s = String(pick).replace(/\s+/g, ' ').trim()
      return s || JSON.stringify(i).slice(0, 140)
    }

    /**
     * One collapsible line of agent work (thinking / tool call). Muted colour so
     * it reads as "process", while the final answer keeps the dark body colour.
     */
    function WorkRow({ icon, label, summary, detail, tone, compact }) {
      const [open, setOpen] = useState(false)
      const expandable = !compact && Boolean(detail)
      return h('div', { className: 'ccp-work ccp-work-' + (tone || 'tool') },
        h('div', {
          className: 'ccp-work-row',
          onClick: expandable ? () => setOpen((v) => !v) : undefined,
          style: expandable ? undefined : { cursor: 'default' },
        },
          h('span', { className: 'ccp-work-ico' }, h(Icon, { name: icon, size: 13 })),
          h('span', { className: 'ccp-work-label' }, label),
          summary ? h('span', { className: 'ccp-work-dot' }, '·') : null,
          summary ? h('span', { className: 'ccp-work-sum' }, summary) : null,
          expandable
            ? h('span', { className: 'ccp-work-chev' + (open ? ' on' : '') }, h(Icon, { name: 'chevron', size: 12 }))
            : null,
        ),
        expandable && open ? h('pre', { className: 'ccp-work-detail' }, String(detail || '').slice(0, 8000)) : null,
      )
    }

    function renderMessage(m, t, notify, idx, approvals, decideApproval, all, prefs) {
      const showThinking = prefs?.showThinking !== false
      const showToolOutput = prefs?.showToolOutput !== false
      const compact = prefs?.transcriptView === 'compact'
      switch (m.kind) {
        case 'blocks':
          return h('div', { key: m.id || idx },
            ...(m.blocks || []).map((b, i) => b.type === 'text'
              ? h(FoldableText, { key: i, text: b.text, t, notify })
              : null),
          )
        case 'thinking': {
          if (!showThinking) return null
          const line = String(m.text || '').replace(/\s+/g, ' ').trim()
          return h(WorkRow, {
            key: m.id || idx, icon: 'think', label: t.thinking, summary: line,
            detail: compact ? '' : (m.text || ''), tone: 'think', compact,
          })
        }
        case 'tool': {
          if (m.parent) return null // rendered inside the agent card
          if (!showToolOutput) return null
          const meta = toolMeta(m.name)
          const res = (all || []).find((x) => x.kind === 'tool_result' && x.id === m.id)
          return h(WorkRow, {
            key: m.id || idx, icon: meta.icon, label: meta.label, summary: toolSummary(m),
            detail: compact ? '' : (JSON.stringify(m.input || {}, null, 2) + (res ? '\n\n── 结果 ──\n' + String(res.text || '').slice(0, 4000) : '')),
            tone: 'tool', compact,
          })
        }
        case 'tool_result':
          return null
        case 'agent_start':
          return h(AgentCard, { key: m.id || idx, m, all, t })
        case 'stats':
        case 'result':
          return null
        case 'log':
          return h('div', { className: 'ccp-foot', key: m.id || idx, style: { opacity: .6 } }, String(m.text || '').slice(0, 200))
        case 'approval':
          return null
        default:
          if (m.role === 'user' && m.text) {
            return h('div', { key: m.id || idx },
              m.interject ? h('div', { className: 'ccp-badge', style: { marginBottom: 5, color: C.coral } }, h(Icon, { name: 'bolt', size: 11 }), ' 插话') : null,
              h(Markdown, { text: m.text }),
              (m.files || []).length ? h('div', { className: 'ccp-attach' },
                ...m.files.map((f, i) => h('span', { className: 'ccp-file', key: i }, h(Icon, { name: 'paperclip', size: 11 }), f.name)),
              ) : null,
            )
          }
          if (m.text) return h(FoldableText, { key: m.id || idx, text: m.text, t, notify })
          return null
      }
    }

    function AgentCard({ m, all, t }) {
      const children = (all || []).filter((x) =>
        x.parent === m.id || (x.kind === 'tool_result' && x.id === m.id))
      const task = m.input?.prompt || m.input?.description || m.input?.task || ''
      return h('div', { className: 'ccp-agent' },
        h('div', { className: 'ccp-agent-h' },
          h(Logo, { size: 17 }),
          h('span', {}, t.agent + ' · ' + (m.name || 'Task')),
          h('span', { className: 'ccp-badge', style: { marginLeft: 'auto' } }, children.length + ' ' + t.subtasks),
        ),
        task ? h('div', { className: 'ccp-agent-task' }, String(task).slice(0, 1200)) : null,
        children.length ? h('div', { className: 'ccp-agent-sub' },
          ...children.slice(0, 12).map((c, i) => h('div', { key: i },
            h('span', { style: { color: C.coral } }, c.kind === 'tool_result' ? '↳ ' : '· '),
            (c.name || c.kind || 'tool') + ' ' + (c.kind === 'tool_result' ? String(c.text || '').slice(0, 90) : JSON.stringify(c.input || {}).slice(0, 90)),
          )),
        ) : null,
      )
    }

    function FoldableText({ text, t, notify }) {
      // Copy lives once per message group (see renderGroup) — no per-block button.
      return h('div', { className: 'ccp-readable' }, h(Markdown, { text }))
    }

    function Fold({ title, open: initialOpen = false, children }) {
      const [open, setOpen] = useState(initialOpen)
      return h('div', { className: 'ccp-fold' },
        h('div', { className: 'ccp-fold-head', onClick: () => setOpen((v) => !v) },
          h(Icon, { name: 'chevron', size: 12, color: open ? C.coral : C.ink2 }), title,
        ),
        open ? children : null,
      )
    }

    /* ======================================================== settings view */
    function SettingsView({ t, lang, setLang, settings, setSettings, api, notify, modelInfo, setModelInfo, cliInfo, setCliInfo, health, cwd, setCwd }) {
      const [tab, setTab] = useState('general')
      const [draft, setDraft] = useState(settings || {})
      const [defs, setDefs] = useState({ groups: [], items: [] })
      const [saving, setSaving] = useState(false)
      const [upgrade, setUpgrade] = useState(null) // /upgrade/check payload
      const [upStatus, setUpStatus] = useState(null) // /upgrade/status payload
      const [upErr, setUpErr] = useState('') // why /upgrade refused to start
      const [, setTick] = useState(0) // re-render once a second while npm runs
      const [mobile, setMobile] = useState({ interfaces: [], state: {} })
      const [mobileHost, setMobileHost] = useState('')
      const [mobileBusy, setMobileBusy] = useState(false)
      const [mobileErr, setMobileErr] = useState('')

      useEffect(() => {
        api('/settings').then((d) => {
          setDefs({ groups: d.groups || [], items: d.items || [] })
          setDraft(d.values || {})
        }).catch(() => {})
        api('/upgrade/status').then(setUpStatus).catch(() => {})
      }, [])

      const loadMobile = useCallback(async () => {
        try {
          const d = await api('/mobile')
          setMobile({ interfaces: d.interfaces || [], state: d.state || {} })
          setMobileHost((cur) => cur || (d.interfaces && d.interfaces[0] && d.interfaces[0].address) || '')
        } catch (e) { /* backend down */ }
      }, [api])

      useEffect(() => { loadMobile() }, [loadMobile])

      // Poll while an npm install runs, then re-check the installed version.
      useEffect(() => {
        if (!upStatus || !upStatus.running) return undefined
        const timer = setInterval(async () => {
          try {
            const s = await api('/upgrade/status')
            setUpStatus(s)
            if (!s.running) {
              clearInterval(timer)
              try { setUpgrade(await api('/upgrade/check')) } catch (e) { /* ignore */ }
              try { setCliInfo(await api('/cli')) } catch (e) { /* ignore */ }
            }
          } catch (e) { /* keep polling */ }
        }, 1200)
        return () => clearInterval(timer)
      }, [upStatus && upStatus.running, api, setCliInfo])

      // A live elapsed counter. Without it a silent npm run is indistinguishable
      // from a button that did nothing.
      useEffect(() => {
        if (!upStatus || !upStatus.running) return undefined
        const timer = setInterval(() => setTick((n) => n + 1), 1000)
        return () => clearInterval(timer)
      }, [upStatus && upStatus.running])

      const groups = defs.groups.length ? defs.groups : [
        { id: 'general', label: { zh: t.general, en: t.general } },
        { id: 'appearance', label: { zh: t.appearance, en: t.appearance } },
        { id: 'tools', label: { zh: t.toolsGroup, en: t.toolsGroup } },
        { id: 'model', label: { zh: t.modelGroup, en: t.modelGroup } },
        { id: 'session', label: { zh: t.sessionGroup, en: t.sessionGroup } },
        { id: 'advanced', label: { zh: t.advanced, en: t.advanced } },
      ]
      const allGroups = [...groups, { id: 'mobile', label: { zh: t.mobile, en: t.mobile } }]
      const items = (defs.items || []).filter((it) => it.group === tab)
      // `SETTINGS_ITEMS` labels are plain strings; group labels are {zh,en}.
      // Rendering the raw key when a string slipped through looked like a bug.
      const labelOf = (x, fallback) => {
        if (typeof x === 'string') return x
        if (x && typeof x === 'object') return x[lang] || x.zh || x.en || fallback || ''
        return fallback || ''
      }
      const optionLabel = (opt) => (t.modeLabels && t.modeLabels[opt]) || opt

      const save = async () => {
        setSaving(true)
        try {
          const r = await api('/settings', { method: 'POST', body: draft })
          setSettings(r.values)
          setDraft(r.values)
          if (r.values.default_cwd) setCwd(r.values.default_cwd)
          if (r.values.language) setLang(r.values.language)
          notify(t.saved)
        } catch (e) { notify(e.message || '') }
        setSaving(false)
      }
      const chooseModel = async (m) => {
        try {
          await api('/model/select', { method: 'POST', body: m })
          setModelInfo((prev) => ({ ...prev, selected: m }))
          notify(t.saved)
        } catch (e) { notify(e.message || '') }
      }
      const checkUpgrade = async () => {
        try { setUpgrade(await api('/upgrade/check')) } catch (e) { setUpgrade({ ok: false, error: e.message || '' }) }
      }
      const doUpgrade = async () => {
        setUpErr('')
        try {
          const r = await api('/upgrade', { method: 'POST', body: {} })
          setUpStatus({ running: true, started: Date.now(), ...r })
          notify(t.upgradeRunning)
        } catch (e) {
          // A toast disappears; a failed start must stay on screen next to the button.
          setUpErr(e.message || String(e))
          setUpStatus(null)
        }
      }
      const startMobile = async () => {
        setMobileBusy(true)
        setMobileErr('')
        try {
          const r = await api('/mobile/start', { method: 'POST', body: { host: mobileHost } })
          // `note` explains a port substitution — worth showing, not hiding.
          setMobile((m) => ({ ...m, state: r.state, note: r.note || '' }))
        } catch (e) { setMobileErr(e.message || '') }
        setMobileBusy(false)
      }
      const stopMobile = async () => {
        setMobileBusy(true)
        try {
          const r = await api('/mobile/stop', { method: 'POST', body: {} })
          setMobile((m) => ({ ...m, state: r.state }))
        } catch (e) { setMobileErr(e.message || '') }
        setMobileBusy(false)
      }

      const linkRow = (label, value) => h('div', { className: 'ccp-field' },
        h('label', { className: 'ccp-label' }, label),
        h('div', { style: { display: 'flex', gap: 8, alignItems: 'center' } },
          h('code', {
            style: { flex: 1, fontSize: 12.5, padding: '7px 10px', border: '1px solid var(--line)', borderRadius: 7, background: 'var(--bg)', wordBreak: 'break-all', userSelect: 'all' },
          }, value || '—'),
          value ? h('button', {
            className: 'ccp-btn', onClick: () => { copyText(value); notify(t.copied) },
          }, t.mobileCopy) : null,
        ),
      )

      const upCurrent = upgrade?.current || cliInfo?.version || '-'
      const upLatest = upgrade?.latest || ''

      return h('div', { className: 'ccp-wrap', style: { padding: '18px 24px', overflowY: 'auto', height: '100%' } },
        h('div', { className: 'ccp-tabs' },
          ...allGroups.map((g) => h('div', {
            key: g.id, className: 'ccp-tab' + (tab === g.id ? ' on' : ''), onClick: () => setTab(g.id),
          }, labelOf(g.label, g.id))),
        ),
        tab === 'model' ? h('div', {},
          h('div', { className: 'ccp-field' },
            h('label', { className: 'ccp-label' }, t.model),
            h('div', { style: { display: 'flex', flexDirection: 'column', gap: 5, maxHeight: 320, overflowY: 'auto' } },
              ...(modelInfo.models || []).map((m, i) => {
                const on = modelInfo.selected && modelInfo.selected.provider === m.provider && modelInfo.selected.model === m.model
                return h('button', {
                  key: i, className: 'ccp-btn', style: { textAlign: 'left', borderColor: on ? C.coral : undefined, background: on ? C.coralSoft : undefined },
                  onClick: () => chooseModel(m),
                }, (on ? '✓ ' : '') + m.provider + ' / ' + m.model + (m.local ? ' · local' : ''))
              }),
              !(modelInfo.models || []).length ? h('div', { className: 'ccp-empty' }, t.loading) : null,
            ),
          ),
        ) : null,
        tab === 'mobile' ? h('div', {},
          h('div', { className: 'ccp-hint', marginBottom: 12 }, t.mobileHint),
          h('div', { className: 'ccp-field' },
            h('label', { className: 'ccp-label' }, t.mobileIfaces),
            h('select', {
              className: 'ccp-select', value: mobileHost,
              onChange: (e) => setMobileHost(e.target.value),
            }, ...(mobile.interfaces || []).map((i2) => h('option', { key: i2.address, value: i2.address },
              i2.name + ' · ' + i2.address))),
            !(mobile.interfaces || []).length ? h('div', { className: 'ccp-hint' }, '未检测到局域网 IPv4 地址') : null,
          ),
          h('div', { style: { display: 'flex', gap: 8, marginTop: 4 } },
            mobile.state?.running
              ? h('button', { className: 'ccp-btn', onClick: stopMobile, disabled: mobileBusy }, t.mobileStop)
              : h('button', { className: 'ccp-btn primary', onClick: startMobile, disabled: mobileBusy || !mobileHost },
                mobileBusy ? t.mobileStarting : t.mobileStart),
            h('button', { className: 'ccp-btn ghost', onClick: loadMobile, disabled: mobileBusy }, t.refresh || '↻'),
          ),
          mobileErr ? h('div', { className: 'ccp-errbox', style: { marginTop: 10 } }, mobileErr) : null,
          mobile.note ? h('div', { className: 'ccp-hint', style: { marginTop: 8 } }, mobile.note) : null,
          mobile.state?.running
            ? h('div', { style: { marginTop: 14 } },
              linkRow(t.mobileShort, mobile.state.shortUrl),
              linkRow(t.mobileLong, mobile.state.url),
              h('div', { className: 'ccp-hint' },
                'DSH 监听 ' + mobile.state.host + ':' + mobile.state.port + ' · PID ' + (mobile.state.pid || '-')),
            )
            : null,
        ) : null,
        tab !== 'mobile' ? items.map((it) => h('div', { className: 'ccp-field', key: it.key },
          h('label', { className: 'ccp-label' }, labelOf(it.label, it.key)),
          it.type === 'boolean'
            ? h('label', { className: 'ccp-switch' },
              h('input', { type: 'checkbox', checked: Boolean(draft[it.key]), onChange: (e) => setDraft((d) => ({ ...d, [it.key]: e.target.checked })) }),
              draft[it.key] ? 'ON' : 'OFF',
            )
            : it.type === 'enum'
              ? h('select', { className: 'ccp-select', value: draft[it.key] ?? it.default, onChange: (e) => setDraft((d) => ({ ...d, [it.key]: e.target.value })) },
                ...(it.options || []).map((o) => h('option', { key: o, value: o }, optionLabel(o))),
              )
              : it.type === 'textarea'
                ? h('textarea', { className: 'ccp-textarea', value: draft[it.key] ?? '', onChange: (e) => setDraft((d) => ({ ...d, [it.key]: e.target.value })) })
                : h('input', {
                  className: 'ccp-input', type: it.type === 'number' ? 'number' : 'text',
                  value: draft[it.key] ?? '', onChange: (e) => setDraft((d) => ({ ...d, [it.key]: it.type === 'number' ? Number(e.target.value) : e.target.value })),
                }),
        )) : null,
        tab === 'advanced' ? h('div', { className: 'ccp-field', style: { border: '1px solid var(--line)', borderRadius: 9, padding: 12, marginTop: 8 } },
          h('label', { className: 'ccp-label' }, t.upgrade),
          health && health.build && health.build.stale
            ? h('div', { className: 'ccp-hint', style: { color: C.coral, marginBottom: 8 } }, t.upgradeStale)
            : null,
          h('div', { className: 'ccp-foot', style: { marginBottom: 8 } },
            h('span', {}, t.current + ': ' + upCurrent),
            upLatest ? h('span', {}, t.upgradeLatest + ': ' + upLatest) : null,
            upgrade && upgrade.ok && upgrade.hasUpdate
              ? h('span', { className: 'ccp-badge' }, t.upgradeNew) : null,
            upgrade && upgrade.ok && upgrade.upToDate
              ? h('span', { className: 'ccp-badge ok' }, t.upgradeOk) : null,
            health && health.build && health.build.loadedAt
              ? h('span', {}, t.upgradeBuild + ': ' + new Date(health.build.loadedAt).toLocaleString())
              : null,
          ),
          upgrade && upgrade.ok && upgrade.upToDate
            ? h('div', { className: 'ccp-hint', style: { marginBottom: 8 } }, t.upgradeUpToDateHint)
            : null,
          upgrade && !upgrade.ok && upgrade.error
            ? h('div', { className: 'ccp-hint', style: { color: C.coral, marginBottom: 8 } }, t.upgradeFailed + ': ' + upgrade.error)
            : null,
          upErr
            ? h('div', { className: 'ccp-hint', style: { color: C.coral, marginBottom: 8 } }, t.upgradeStartFailed + ': ' + upErr)
            : null,
          h('div', { style: { display: 'flex', gap: 8, alignItems: 'center' } },
            h('button', { className: 'ccp-btn', onClick: checkUpgrade }, t.upgradeCheck),
            h('button', {
              className: 'ccp-btn primary', onClick: doUpgrade,
              disabled: Boolean(upStatus && upStatus.running),
            }, upStatus && upStatus.running
              ? t.upgradeRunning + ' ' + Math.max(0, Math.round((Date.now() - (upStatus.started || Date.now())) / 1000)) + 's'
              : (upgrade && upgrade.ok && !upgrade.hasUpdate ? t.upgradeReinstall : t.upgradeRun)),
          ),
          upStatus && upStatus.command
            ? h('div', { className: 'ccp-hint', style: { marginTop: 6, wordBreak: 'break-all' } }, '$ ' + upStatus.command)
            : null,
          upStatus && upStatus.running === false && upStatus.ok !== null && upStatus.ok !== undefined
            ? h('div', { className: 'ccp-hint', style: { marginTop: 6, color: upStatus.ok ? C.ink2 : C.coral } },
              upStatus.ok
                ? (upStatus.changed ? t.upgradeDone + ': ' + (upStatus.before || '?') + ' → ' + (upStatus.after || '?') : t.upgradeNoChange)
                : (upStatus.error || 'npm 执行失败'))
            : null,
          upStatus && upStatus.log
            ? h('pre', {
              style: { marginTop: 8, maxHeight: 200, overflow: 'auto', fontSize: 11, background: 'var(--bg)', border: '1px solid var(--line)', borderRadius: 7, padding: 8 },
            }, upStatus.log.slice(-4000))
            : null,
        ) : null,
        tab !== 'mobile' ? h('div', { className: 'ccp-actions' },
          h('button', { className: 'ccp-btn ghost', onClick: async () => {
            try { const r = await api('/settings/reset', { method: 'POST', body: {} }); setDraft(r.values); setSettings(r.values); notify(t.saved) } catch (e) {}
          } }, t.reset),
          h('button', { className: 'ccp-btn primary', onClick: save, disabled: saving }, saving ? t.saving : t.save),
        ) : null,
        health ? h('div', { className: 'ccp-hint', style: { marginTop: 12 } },
          'DSH bridge :' + (health.bridge?.port || '-') + ' · PID ' + health.pid) : null,
      )
    }

    /* ================================================================ mount */
    return {
      inject: ['slots'],
      apply(ctx) {
        ctx.slots.inject('sidebar.panellist', () =>
          ctx.slots.register(
            { name: 'sidebar.panellist', id: PANEL_ID, order: 24, label: () => 'Claude Code Desktop' },
            function SidebarIcon({ size = 20, active }) {
              return h('img', {
                src: MARK, width: size, height: size, alt: 'Claude Code',
                style: { display: 'block', objectFit: 'contain', opacity: active ? 1 : .85 },
              })
            },
          ),
        )
        ctx.slots.inject('main', () =>
          ctx.slots.register({ name: 'main', key: PANEL_ID }, function MainPanel() {
            return h(React.Fragment, {}, h('style', { dangerouslySetInnerHTML: { __html: CSS } }), h(Panel))
          }),
        )
      },
    }
  },
})
