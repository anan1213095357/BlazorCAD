# 原生 WebGPU 迁移记录

2026-10-26。迁移前代码已提交并推送到指定仓库 main，提交 9051c8e。

## 已修改的实际入口

- cad.js 的 init 变为异步，等待自写 CadWebGPURenderer 初始化；没有调用 Three.js WebGPURenderer，也没有回退到 WebGL。
- wwwroot/webgpu/renderer.js 直接创建 GPUDevice、GPUCanvasContext、顶点缓冲、存储缓冲、uniform、管线和命令编码器。
- wwwroot/webgpu/cad-shader.js 是自写 WGSL：实体与线条、MSAA、深度测试、透明混合、金属/粗糙度照明、贴图及三平面映射、屏幕宽度草图线、可见/遮挡调试线。
- 倒角沿用现有几何记录，但裁切与圆角交接判断已写成 WGSL；替换面偏移和普通倒角运动通过 uniform 更新，不在拖动时重新上传整张网格。
- live-fillet、edge-motion-gpu 和 debug-wireframe 提供显式的 GPU 参数描述，不依赖 onBeforeCompile 字符串在新渲染器中执行。
- 已删除 importmap、three.module.js、three.core.js、OrbitControls、Reflector 和 npm 的 three 依赖。入口、后台 worker、导出以及回归用例均直接导入 engine/core.js。
- 浏览器回归入口已改为等待异步 init，但未执行。

## 用户明确禁止任何 Three.js 后的第二步替换

- engine/math.js 自写向量、四元数、矩阵、包围盒、平面、线段、三角形最近点和射线求交。
- engine/shapes.js 自写路径采样、带孔多边形桥接/耳裁三角化、面积一致性校验和向心样条采样。
- engine/scene.js 自写相机、场景树、顶点属性/几何、拉伸、材质/纹理描述、射线拾取、标注精灵和方向游标。沿用部分常见类名和调用形式以保持业务层边界稳定，内部没有导入或转发原库，也没有复制 vendored 实现。
- cad-controls.js 已重写鼠标/触摸旋转、平移和缩放；surface-studio.js、edge-motion-gpu.js 和 debug-wireframe.js 已改为直接提供原生渲染参数。旧 onBeforeCompile 注入和倒角 GLSL 字符串已清除。
- 项目包清单、锁文件和可发布 vendor 目录已移除原库；此前 main 的备份提交按用户要求保留原版本。
- GPU 当前采用新的直接照明，旧 PMREM 环境贴图、地面镜面反射、阴影贴图、清漆与各向异性微表面尚未迁移；原材质面板部分细节在本分支不能保持原效果。地面暂为普通透明平面。
- 倒角拓扑和导出内核没有替换。此前的问题来自原始面、切削体、交接边界和模型/显示的差异，不能将这些错误归因于 Three.js 渲染本身，也不能用换 WebGPU 代替拓扑修复。

## 验证状态

遵守 AGENTS.md，本次没有编译、运行应用、启动浏览器调试或执行测试；仅静态检查源码和 Git 补丁。因此没有实测帧率、性能改善结论或运行成功声明。新渲染器初始化时会等待 WGSL 编译信息，失败时返回明确错误，不会静默退回旧后端。

静态引用检查：当前业务源码使用的 CAD 命名空间符号均有本地定义，所有相对 JS 导入目标存在，包清单和锁文件无 three 依赖。该检查不执行 JavaScript，不能代替语法、几何或 GPU 验证。

新增 tests/engine-regression.mjs 与 npm run test:engine 入口，覆盖四元数/矩阵/相机往返、射线、双孔截面面积、闭合拉伸体积和拾取、手工预览矩阵保留；用例已编写但未执行。

需要实际验证的顺序：上述 CPU 用例；GPU 初始化；空场景及正交/透视相机；矩形/圆/曲线草图及拾取；加载保存模型；同次相邻边倒角；二次/三次倒角；拖动尺寸；调试遮挡线；材质和自定义纹理；反复切换项目与设备丢失后的资源释放。源码依赖移除完成不代表这些运行行为已通过验证。

## 新建草图读取 controls.target 失败

静态定位：WGSL 中错误使用了保留字 meta 作为变量名（规范 https://www.w3.org/TR/WGSL/#reserved-words），会使渲染器在着色器初始化阶段拒绝。该阶段位于相机与控制器创建之前。Home 的 finally 随后清除 initializing，使新建草图重新可点；cameraView 未检查视图就绪，最终读取未创建的 controls.target，掩盖了先前的着色器错误。

修复：变量改为 seamHeader；JS 保存初始化 Promise 和原始错误，update 与 cameraView 等待初始化成功；页面只有初始化完成才标记 viewReady，失败时保留原错误并不允许开始草图事务。自写 Camera 同时补齐 clone，用于视角过渡，保留投影参数与独立的变换对象，避免此处修复后立刻出现 clone 缺失错误。相机复制回归用例已补充，浏览器回归源码等待 update Promise；未运行测试、构建或浏览器。
