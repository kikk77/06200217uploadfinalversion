// 加载环境变量
require('dotenv').config();

// 环境变量检查
const BOT_TOKEN = process.env.BOT_TOKEN;
const PORT = process.env.PORT || 3000;

if (!BOT_TOKEN) {
    console.error('错误: 请设置 BOT_TOKEN 环境变量');
    process.exit(1);
}

// 导入高效服务
const EfficientBotService = require('./services/efficientBotService');
const { initTestData } = require('./utils/initData');
const { initScheduler } = require('./services/schedulerService');

// 全局服务实例
let botService = null;

// 启动函数
async function start() {
    try {
        console.log('🚀 高效Telegram营销机器人启动中...');
        
        // 创建并初始化高效机器人服务
        botService = new EfficientBotService();
        await botService.initialize();
        
        // 初始化测试数据（保持原有逻辑）
        initTestData();
        
        // 启动定时任务调度器（保持原有逻辑）
        initScheduler();
        
        console.log('✅ 高效营销机器人启动完成！');
        console.log('🎯 功能列表:');
        console.log('   - 商家绑定系统（原有逻辑）');
        console.log('   - 按钮点击跳转私聊（原有逻辑）');
        console.log('   - 触发词自动回复（原有逻辑）');
        console.log('   - 定时发送消息（原有逻辑）');
        console.log('   - 消息模板管理（原有逻辑）');
        console.log('   - 完整评价系统（原有逻辑）');
        console.log('   - 完整管理后台（原有逻辑）');
        console.log('🔧 架构特点:');
        console.log('   - 事件驱动，无轮询延迟');
        console.log('   - 符合官方文档标准');
        console.log('   - 模块化，易于维护');
        console.log('   - 保持所有原始业务逻辑');
        
    } catch (error) {
        console.error('❌ 高效机器人启动失败:', error);
        process.exit(1);
    }
}

// 优雅关闭
async function gracefulShutdown() {
    try {
        console.log('🛑 正在优雅关闭高效机器人...');
        
        if (botService) {
            await botService.stop();
        }
        
        console.log('✅ 高效机器人已安全关闭');
        process.exit(0);
        
    } catch (error) {
        console.error('❌ 关闭过程中出现错误:', error);
        process.exit(1);
    }
}

// 错误处理
process.on('uncaughtException', (error) => {
    console.error('💥 未捕获的异常:', error);
    gracefulShutdown();
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('💥 未处理的Promise拒绝:', reason);
    gracefulShutdown();
});

// 优雅关闭信号处理
process.on('SIGTERM', gracefulShutdown);
process.on('SIGINT', gracefulShutdown);

// 启动应用
start(); 