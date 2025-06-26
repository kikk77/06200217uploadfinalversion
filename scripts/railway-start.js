#!/usr/bin/env node

// Railway部署专用启动脚本
// 简化启动流程，确保快速响应健康检查

console.log('🚀 Railway部署启动脚本');
console.log('📅 启动时间:', new Date().toISOString());

// 检查关键环境变量
const requiredEnvs = ['BOT_TOKEN', 'BOT_USERNAME'];
const missingEnvs = requiredEnvs.filter(env => !process.env[env]);

if (missingEnvs.length > 0) {
    console.log('⚠️ 缺少环境变量:', missingEnvs.join(', '));
    console.log('💡 将使用默认配置启动，请在Railway Variables中设置正确的环境变量');
}

// 设置NODE_ENV
process.env.NODE_ENV = process.env.NODE_ENV || 'production';

// 确保数据目录存在并修复权限
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');

const dataDir = '/app/data'; // 直接使用Volume挂载路径

// 检查并修复权限
try {
    if (fs.existsSync(dataDir)) {
        console.log('📁 数据目录存在:', dataDir);
        
        // 检查权限
        try {
            fs.accessSync(dataDir, fs.constants.W_OK);
            console.log('✅ 数据目录权限正常');
        } catch (permError) {
            console.log('🔧 修复数据目录权限...');
            
            // 尝试修复权限
            try {
                exec('chmod 755 /app/data', (error, stdout, stderr) => {
                    if (!error) {
                        console.log('✅ 权限修复成功');
                    } else {
                        console.log('⚠️ 权限修复失败，但继续启动');
                    }
                });
                
                // 给一点时间让权限修复生效
                setTimeout(() => {
                    console.log('⏳ 等待权限修复生效...');
                }, 500);
            } catch (fixError) {
                console.log('⚠️ 权限修复失败，但继续启动');
            }
        }
    } else {
        fs.mkdirSync(dataDir, { recursive: true });
        console.log('📁 创建数据目录:', dataDir);
    }
} catch (error) {
    console.log('⚠️ 数据目录处理失败，但继续启动:', error.message);
}

// 启动主应用
console.log('🎯 启动主应用...');

async function startApp() {
    // 等待权限修复完成
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    // 初始化数据库表结构和示例数据
    console.log('🔧 初始化数据库表结构和示例数据...');
    try {
        // 先尝试基础表结构初始化
        const { initializeDatabase } = require('./init-database.js');
        const basicSuccess = initializeDatabase();
        
        // 再尝试staging数据初始化
        const { initializeDatabase: initStagingData } = require('./init-staging-data.js');
        const stagingSuccess = initStagingData();
        
        if (basicSuccess && stagingSuccess) {
            console.log('✅ 数据库和示例数据初始化成功');
        } else {
            console.log('⚠️ 数据库初始化部分失败，但继续启动');
        }
    } catch (error) {
        console.log('⚠️ 数据库初始化异常:', error.message);
        console.log('📋 继续启动应用...');
    }
    
    require('../app.js');
}

startApp(); 