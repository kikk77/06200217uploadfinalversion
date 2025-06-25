const Database = require('better-sqlite3');
const path = require('path');

console.log('🔧 开始修复regions表active字段...');

try {
    // 连接到数据库
    const dbPath = path.join(__dirname, '../data/marketing_bot.db');
    const db = new Database(dbPath);
    
    console.log('📋 检查regions表结构...');
    
    // 检查表结构
    const tableInfo = db.prepare("PRAGMA table_info(regions)").all();
    const hasActiveField = tableInfo.some(column => column.name === 'active');
    
    if (hasActiveField) {
        console.log('✅ regions表已经有active字段，无需修复');
    } else {
        console.log('❌ regions表缺少active字段，开始修复...');
        
        // 添加active字段
        db.exec('ALTER TABLE regions ADD COLUMN active INTEGER DEFAULT 1');
        
        // 更新所有现有记录的active字段为1
        const updateResult = db.prepare('UPDATE regions SET active = 1 WHERE active IS NULL').run();
        
        console.log(`✅ 已添加active字段并更新了 ${updateResult.changes} 条记录`);
        
        // 验证修复结果
        const verifyInfo = db.prepare("PRAGMA table_info(regions)").all();
        const verifyHasActive = verifyInfo.some(column => column.name === 'active');
        
        if (verifyHasActive) {
            console.log('✅ 修复验证成功，active字段已存在');
            
            // 显示当前数据
            const regions = db.prepare('SELECT * FROM regions ORDER BY sort_order').all();
            console.log('📊 当前regions表数据:');
            console.table(regions);
        } else {
            console.log('❌ 修复验证失败');
        }
    }
    
    db.close();
    console.log('🎯 regions表active字段修复完成！');
    
} catch (error) {
    console.error('❌ 修复过程中出现错误:', error);
    process.exit(1);
} 