# 原生 WebGPU 迁移记录

2026-10-26。迁移前代码已提交并推送到指定仓库 main，提交 9051c8e。

## 已修改的实际入口

- cad.js 的 init 变为异步，等待自写 CadWebGPURenderer 初始化；没有调用 Three.js WebGPURenderer，也没有回退到 WebGL。
- wwwroot/webgpu/renderer.js 直接创建 GPUDevice、GPUCanvasContext、顶点缓冲、存储缓冲、uniform、管线和命令编码器。
- wwwroot/webgpu/cad-shader.js 是自写 WGSL：实体与线条、MSAA、深度测试、透明混合、金属/粗糙度照明、贴图及三平面映射、屏幕宽度草图线、可见/遮挡调试线。
- 倒角沿用现有几何记录，但裁切与圆角交接判断已写成 WGSL；替换面偏移和普通倒角运动通过 uniform 更新，不在拖动时重新上传整张网格。
- live-fillet、edge-motion-gpu 和 debug-wireframe 提供显式的 GPU 参数描述，不依赖 onBeforeCompile 字符串在新渲染器中执行。
- 入口 importmap 和直接导入不再加载 three.module.js 中的 WebGL 渲染代码，改为仅加载现有 three.core.js 供 CPU 数据兼容。
- 浏览器回归入口已改为等待异步 init，但未执行。

## 尚未完成，不能称为彻底移除 Three.js

- three.core.js 仍提供向量、矩阵、场景对象、相机、BufferGeometry、ShapeGeometry、材质数据和 CPU 拾取；OrbitControls 也仍是原依赖。这些不是自写模块。
- npm 的 three 依赖和带版权的 vendored 文件仍保留，没有通过改名冒充自写实现。
- GPU 当前采用新的直接照明，旧 PMREM 环境贴图、地面镜面反射、阴影贴图、清漆与各向异性微表面尚未迁移；原材质面板部分细节在本分支不能保持原效果。地面暂为普通透明平面。
- 倒角拓扑和导出内核没有替换。此前的问题来自原始面、切削体、交接边界和模型/显示的差异，不能将这些错误归因于 Three.js 渲染本身，也不能用换 WebGPU 代替拓扑修复。

## 验证状态

遵守 AGENTS.md，本次没有编译、运行应用、启动浏览器调试或执行测试；仅静态检查源码和 Git 补丁。因此没有实测帧率、性能改善结论或运行成功声明。新渲染器初始化时会等待 WGSL 编译信息，失败时返回明确错误，不会静默退回旧后端。

需要实际验证的顺序：GPU 初始化；空场景及正交/透视相机；矩形/圆/曲线草图及拾取；加载保存模型；同次相邻边倒角；二次/三次倒角；拖动尺寸；调试遮挡线；材质和自定义纹理；反复切换项目与设备丢失后的资源释放。完全替换前还需要自写 CPU 场景/数学/拾取层及其几何回归验证。
