# 图提取 ImageGrab

Chrome 扩展（Manifest V3）：在淘宝、天猫、京东、拼多多商品详情页一键提取商品图片，于新标签页勾选并批量下载为 PNG。

## 功能

- 详情页右下角悬浮按钮「获取图片」
- 扫描 `<img>`、`srcset`、懒加载属性与 `background-image`
- 过滤图标、logo、占位图及小于 100×100 的图片
- 画廊页网格预览：全选 / 反选 / 已选数量
- Service Worker 内 `fetch` + `OffscreenCanvas` 统一转 PNG
- 文件名：`商品图_001.png`（序号补零），默认保存到下载目录下的 `ImageGrab/` 文件夹

## 文件结构

```
ImageGrab/
├── manifest.json    # MV3 清单
├── content.js       # 详情页检测、悬浮按钮、图片提取
├── content.css      # 悬浮按钮样式
├── background.js    # 消息处理、转 PNG、下载
├── gallery.html     # 画廊页面
├── gallery.js       # 勾选与下载交互
├── gallery.css      # 画廊样式
└── README.md
```

## 安装方法

1. 打开 Chrome，访问 `chrome://extensions/`
2. 右上角开启「开发者模式」
3. 点击「加载已解压的扩展程序」
4. 选择本项目文件夹 `ImageGrab`
5. 安装成功后，扩展列表中会出现「图提取 ImageGrab」

## 使用方法

1. 打开淘宝 / 天猫 / 京东 / 拼多多的**商品详情页**
2. 页面右下角出现蓝色「获取图片」按钮
3. 点击后等待扫描（按钮显示「提取中」）
4. 自动打开画廊新标签页，默认全选
5. 按需取消勾选，或使用「全选」「反选」
6. 点击「下载选中」，等待进度条完成
7. 在浏览器下载目录的 `ImageGrab/` 中查看 PNG 文件

## 权限说明

| 权限 / Host | 用途 |
|-------------|------|
| `activeTab` / `scripting` | 在详情页注入脚本与样式 |
| `downloads` | 批量保存 PNG |
| `storage` | 临时保存提取到的图片列表 |
| `*.taobao.com` 等站点 | 匹配商品页与注入内容脚本 |
| `*.alicdn.com` / `*.360buyimg.com` / `*.pddpic.com` | 跨域拉取 CDN 图片并转 PNG |

## 技术说明

- **仅详情页显示按钮**：`content.js` 根据各平台 URL 规则判断，非详情页不注入按钮
- **跨域转 PNG**：在 Service Worker 中完成，避免页面 CORS 与 Canvas 污染问题
- **部分 CDN 防盗链**：若个别图片转换失败，画廊会统计失败数量；可取消失败项后重试其余图片

## 兼容性

- 建议使用 Chrome 110+（需支持 Service Worker、`OffscreenCanvas`、`createImageBitmap`）
- Edge（Chromium）同样可加载本扩展

## 开发提示

修改代码后，在 `chrome://extensions/` 点击本扩展的「重新加载」，再刷新商品详情页即可生效。
