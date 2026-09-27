export type Translate = (key: keyof typeof words.zh) => string;
declare module '@deepseek-ai/dsh-client-ui-slots' { interface LocaleNamespaceMap { '@zaimokuza/dsh-agent-teams-office': keyof typeof words.zh } }
export const words = {
  zh: {
    activity_talk: '发送消息', activity_listen: '收到消息', activity_take: '领取任务', activity_pin: '张贴任务', activity_archive: '归档任务', activity_cheer: '任务完成', activity_coffee: '咖啡休息', activity_water: '接水', activity_plant: '浇花', activity_window: '开窗通风', activity_fridge: '打开冰箱', activity_books: '翻阅书籍', activity_bin: '整理垃圾', activity_smoke: '窗边休息', activity_brew: '准备饮品', activity_drink: '喝饮品', activity_wash: '清洗杯子', activity_cup: '拿杯子', activity_carry: '携带便签',
    title: '办公室', description: '在像素或 3D 办公室中查看团队', emptyHint: '在会话中创建或打开 Agent Team。',
    viewMode: '办公室视图', pixelView: '像素', orbitHint: '拖动旋转 · 滚轮缩放', floatOffice: '悬浮显示办公室',
    disabled: 'Agent Teams 尚未启用', inactive: '团队尚未加载', unselected: '请选择团队会话', live: '团队暂无成员',
    running: '工作中', idle: '空闲', inactiveStatus: '休息中', provisioning: '正在启动', failed: '失败',
    selectHint: '点击人物查看状态', fit: '全景', focus: '聚焦', focusing: '聚焦中', stopFocus: '取消聚焦并恢复原视角', dismiss: '关闭成员详情',
    stale: '连接中断 · 状态可能已过期', reconnect: '重试', loading: '正在连接团队…', sceneError: '场景加载失败',
    credits: '原创场景：DSH Studio', overflow: '预留 16 个队友工位；更多成员请查看 Agent Team 面板',
  },
  en: {
    activity_talk: 'Sending a message', activity_listen: 'Message received', activity_take: 'Collecting a task', activity_pin: 'Posting a task', activity_archive: 'Archiving a task', activity_cheer: 'Task completed', activity_coffee: 'Coffee break', activity_water: 'Getting water', activity_plant: 'Watering plants', activity_window: 'Opening the window', activity_fridge: 'Opening the fridge', activity_books: 'Reading', activity_bin: 'Tidying up', activity_smoke: 'Window break', activity_brew: 'Preparing a drink', activity_drink: 'Drinking', activity_wash: 'Washing a cup', activity_cup: 'Picking up a cup', activity_carry: 'Carrying a note',
    title: 'Office', description: 'View your team in a pixel or 3D office', emptyHint: 'Create or open an Agent Team in the conversation.',
    viewMode: 'Office view', pixelView: 'Pixel', orbitHint: 'Drag to orbit · Scroll to zoom', floatOffice: 'Float office',
    disabled: 'Agent Teams is not enabled', inactive: 'Team is not loaded', unselected: 'Choose a team session', live: 'No team members',
    running: 'Working', idle: 'Idle', inactiveStatus: 'On a break', provisioning: 'Starting', failed: 'Failed',
    selectHint: 'Select a character to view status', fit: 'Fit', focus: 'Focus', focusing: 'Following', stopFocus: 'Stop following and restore the previous view', dismiss: 'Dismiss member details',
    stale: 'Disconnected · State may be outdated', reconnect: 'Retry', loading: 'Connecting to the team…', sceneError: 'Scene failed to load',
    credits: 'Original art: DSH Studio', overflow: '16 teammate desks; see Agent Team for additional members',
  },
};
