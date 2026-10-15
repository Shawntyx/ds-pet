// 排查用脚本（不参与构建）：在真正的 Electron 环境里检查 API Key 能不能读出来。
// 跑法：node scripts\diagnose-key.js 不行（那是纯 Node），要跑：
//   node_modules\electron\dist\electron.exe scripts\diagnose-key.js
// 注意：环境里如果有 ELECTRON_RUN_AS_NODE=1，要先删掉，否则 electron.exe 会用 Node 模式跑。
const { app, safeStorage } = require('electron');
const fs = require('fs');
const path = require('path');

// 这个脚本不通过 package.json 启动，app 名会默认成 "Electron"，
// 所以手动指到 whale-pet 的 userData 目录。
app.setPath('userData', path.join(app.getPath('appData'), 'whale-pet'));

app.whenReady().then(() => {
  const ud = app.getPath('userData');
  const keyFile = path.join(ud, 'apikey.enc');
  console.log('userData      :', ud);
  console.log('electron 版本  :', process.versions.electron, '| chrome', process.versions.chrome);
  console.log('key 文件存在   :', fs.existsSync(keyFile));

  let available = false;
  try {
    available = safeStorage.isEncryptionAvailable();
  } catch (err) {
    console.log('isEncryptionAvailable 抛错:', err.message);
  }
  console.log('加密可用       :', available);

  if (fs.existsSync(keyFile)) {
    const buf = fs.readFileSync(keyFile);
    console.log('文件长度       :', buf.length, '| 前 3 字节:', buf.slice(0, 3).toString());
    try {
      // 只报长度，不打印 key 内容——免得诊断日志把密钥漏出去
      const plain = safeStorage.decryptString(buf);
      console.log('解密结果       : 成功，明文长度', plain.length, '（看起来像 DeepSeek key:', /^sk-/.test(plain), '）');
    } catch (err) {
      console.log('解密结果       : 失败 ->', err.message);
    }
  }

  app.exit(0);
});
