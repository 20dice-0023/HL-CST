// 本地存储：所有记录只在这台设备的浏览器里。
// key 单独存放：勾了"记住"放 localStorage，否则放 sessionStorage（关掉页面就没了），导出时永远不带 key。

const DATA_KEY = "hlcst.data.v1";
const SETTINGS_KEY = "hlcst.settings.v1";
const SECRETS_KEY = "hlcst.secrets.v1";

export function emptyData() {
  return {
    version: 1,
    sessions: [],
    profile: {
      firstReportAt: null, // 第一次看报告（含自我预测那一步）的时间；之后做的都算知情后
      docsReadAt: null, // 第一次在网站里打开"它是怎么运作的"的时间；之后做的也算知情后（见 session.js 的 informedAt）
      reportPending: false, // 旧版选项"做完第二次再看"留下的标记，看报告时清掉
      reports: [],
      feedback: {}, // 假设 id -> { view, comment }
      annotations: {}, // "session.id:round.index"（哪一轮的哪一组） -> { why, problem, recheck }
      selfPrediction: null, // { most: [轴], least: [轴], at }
      readAxes: null, // 结束页问的：在网站以外读没读过这个项目的说明（只在报告里提一句，不改统计）
      lifeStage: null, // 上次开始时选的身份，下次先勾上；每一轮自己也记一份
    },
  };
}

function normalizeData(d) {
  const base = emptyData();
  if (!d || typeof d !== "object" || !Array.isArray(d.sessions)) return base;
  return { ...base, ...d, profile: { ...base.profile, ...(d.profile ?? {}) } };
}

export function loadData() {
  try {
    const raw = localStorage.getItem(DATA_KEY);
    return raw ? normalizeData(JSON.parse(raw)) : emptyData();
  } catch {
    return emptyData();
  }
}

export function saveData(data) {
  localStorage.setItem(DATA_KEY, JSON.stringify(data));
}

export function loadSettingsRaw() {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function saveSettingsRaw(settings) {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}

export function loadSecrets() {
  for (const store of [localStorage, sessionStorage]) {
    try {
      const raw = store.getItem(SECRETS_KEY);
      if (raw) return { keys: {}, ...JSON.parse(raw) };
    } catch {
      // 读不出来就当没有
    }
  }
  return { keys: {} };
}

export function saveSecrets(secrets, remember) {
  const raw = JSON.stringify({ keys: secrets.keys ?? {} });
  if (remember) {
    localStorage.setItem(SECRETS_KEY, raw);
    sessionStorage.removeItem(SECRETS_KEY);
  } else {
    sessionStorage.setItem(SECRETS_KEY, raw);
    localStorage.removeItem(SECRETS_KEY);
  }
}

export function exportData(data) {
  return JSON.stringify({ app: "HL-CST", exportedAt: new Date().toISOString(), data }, null, 2);
}

/** 读导入的文件；格式不对就抛错。 */
export function parseImport(text) {
  const parsed = JSON.parse(text);
  const d = parsed && parsed.app === "HL-CST" ? parsed.data : parsed;
  if (!d || !Array.isArray(d.sessions)) throw new Error("not an HL-CST export");
  return normalizeData(d);
}

export function clearAll() {
  localStorage.removeItem(DATA_KEY);
}

/** 忘掉这台设备上的 key：两个存储里的都删（记住的放在 localStorage，没记住的放在 sessionStorage）。 */
export function forgetSecrets() {
  localStorage.removeItem(SECRETS_KEY);
  sessionStorage.removeItem(SECRETS_KEY);
}

/** 删掉服务商设置（选了哪家、哪个模型、接口地址）。显示设置（亮暗、字号）不在这里。 */
export function clearSettings() {
  localStorage.removeItem(SETTINGS_KEY);
}
