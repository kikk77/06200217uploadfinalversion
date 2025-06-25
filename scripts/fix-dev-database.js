const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

console.log('🔧 开始修复开发数据库数据缺失问题...');

try {
    const dataDir = path.join(__dirname, '../data');
    const productionDbPath = path.join(dataDir, 'marketing_bot.db');
    const devDbPath = path.join(dataDir, 'marketing_bot_dev.db');
    
    // 检查生产数据库是否存在
    if (!fs.existsSync(productionDbPath)) {
        console.error('❌ 生产数据库不存在:', productionDbPath);
        process.exit(1);
    }
    
    // 获取文件大小
    const prodStats = fs.statSync(productionDbPath);
    const devStats = fs.existsSync(devDbPath) ? fs.statSync(devDbPath) : null;
    
    console.log(`📊 生产数据库大小: ${(prodStats.size / 1024).toFixed(1)} KB`);
    console.log(`📊 开发数据库大小: ${devStats ? (devStats.size / 1024).toFixed(1) + ' KB' : '不存在'}`);
    
    // 连接到两个数据库
    const prodDb = new Database(productionDbPath);
    
    // 检查生产数据库中的数据
    console.log('📋 检查生产数据库数据...');
    const regions = prodDb.prepare('SELECT COUNT(*) as count FROM regions').get();
    const merchants = prodDb.prepare('SELECT COUNT(*) as count FROM merchants').get();
    const orders = prodDb.prepare('SELECT COUNT(*) as count FROM orders').get();
    
    console.log(`📊 生产数据库统计:
   - 地区数量: ${regions.count}
   - 商家数量: ${merchants.count}
   - 订单数量: ${orders.count}`);
    
    if (regions.count === 0) {
        console.log('❌ 生产数据库也没有数据，需要先导入数据');
        prodDb.close();
        process.exit(1);
    }
    
    // 如果开发数据库不存在或数据不足，复制生产数据库
    if (!devStats || devStats.size < 50000 || regions.count === 0) {
        console.log('🔄 复制生产数据库到开发数据库...');
        
        // 关闭数据库连接
        prodDb.close();
        
        // 备份现有的开发数据库（如果存在）
        if (fs.existsSync(devDbPath)) {
            const backupPath = devDbPath + '.backup.' + Date.now();
            fs.copyFileSync(devDbPath, backupPath);
            console.log(`📦 已备份现有开发数据库到: ${backupPath}`);
        }
        
        // 复制生产数据库到开发数据库
        fs.copyFileSync(productionDbPath, devDbPath);
        console.log(`✅ 已复制生产数据库到开发数据库`);
        
        // 验证复制结果
        const newDevDb = new Database(devDbPath);
        const newRegions = newDevDb.prepare('SELECT COUNT(*) as count FROM regions').get();
        const newMerchants = newDevDb.prepare('SELECT COUNT(*) as count FROM merchants').get();
        const newOrders = newDevDb.prepare('SELECT COUNT(*) as count FROM orders').get();
        
        console.log(`✅ 复制后开发数据库统计:
   - 地区数量: ${newRegions.count}
   - 商家数量: ${newMerchants.count}
   - 订单数量: ${newOrders.count}`);
        
        newDevDb.close();
    } else {
        console.log('✅ 开发数据库数据正常，无需修复');
        prodDb.close();
    }
    
    console.log('🎯 开发数据库修复完成！');
    
} catch (error) {
    console.error('❌ 修复过程中出现错误:', error);
    process.exit(1);
} 