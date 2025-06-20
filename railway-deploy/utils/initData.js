const dbOperations = require('../models/dbOperations');

// 生成随机数据的辅助函数
function getRandomInt(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

function getRandomElement(arr) {
    return arr[Math.floor(Math.random() * arr.length)];
}

function getRandomDate(startDate, endDate) {
    const start = startDate.getTime();
    const end = endDate.getTime();
    return new Date(start + Math.random() * (end - start));
}

// 初始化基础数据（仅地区数据）
function initTestData() {
    try {
        const { db } = require('../config/database');
        const dbOperations = require('../models/dbOperations');
        
        console.log('🚀 初始化基础数据...');
        
        // 临时禁用外键约束
        db.pragma('foreign_keys = OFF');
        
        // 检查并创建地区数据
        const existingRegions = dbOperations.getAllRegions();
        if (existingRegions.length < 10) {
            console.log('📍 创建地区数据...');
            const regions = [
                '上海', '北京', '广州', '深圳', '杭州', 
                '成都', '武汉', '南京', '西安', '其他'
            ];
            
            // 清空现有地区
            db.prepare('DELETE FROM regions').run();
            
            regions.forEach((name, index) => {
                dbOperations.createRegion(name, index + 1);
            });
            console.log('✅ 地区数据创建完成');
        }

        // 清空所有测试数据
        console.log('🧹 清理测试数据...');
            db.prepare('DELETE FROM bind_codes').run();
            db.prepare('DELETE FROM merchants').run();
        db.prepare('DELETE FROM orders').run();
        db.prepare('DELETE FROM booking_sessions').run();
        db.prepare('DELETE FROM evaluations').run();
        console.log('✅ 测试数据清理完成');
        
        // 重新启用外键约束
        db.pragma('foreign_keys = ON');
        
        console.log('✅ 基础数据初始化完成');
        
    } catch (error) {
        console.error('❌ 初始化测试数据失败:', error);
        // 确保重新启用外键约束
        try {
            const { db } = require('../config/database');
            db.pragma('foreign_keys = ON');
        } catch (e) {
            console.error('恢复外键约束失败:', e);
        }
    }
}

module.exports = {
    initTestData
}; 

// 如果直接运行此文件，执行初始化 - 暂时禁用
// if (require.main === module) {
//     initTestData();
// } 