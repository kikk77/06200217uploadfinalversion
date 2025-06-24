const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

// 数据库路径检测
function getDatabasePath() {
    const paths = [
        '/app/data/marketing_bot.db',  // Railway Volume
        path.join(__dirname, '../data/marketing_bot.db'),  // 应用目录
        path.join(process.cwd(), 'marketing_bot.db')  // 当前目录
    ];
    
    for (const dbPath of paths) {
        try {
            const dir = path.dirname(dbPath);
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
            }
            return dbPath;
        } catch (error) {
            continue;
        }
    }
    
    return paths[1]; // 默认使用应用目录
}

function initializeDatabase() {
    const dbPath = getDatabasePath();
    console.log(`🔧 初始化数据库: ${dbPath}`);
    
    try {
        const db = new Database(dbPath);
        console.log('✅ 数据库连接成功');
        
        // 创建所有必要的表
        const tables = [
            {
                name: 'bind_codes',
                sql: `CREATE TABLE IF NOT EXISTS bind_codes (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    code TEXT UNIQUE NOT NULL,
                    description TEXT,
                    used INTEGER DEFAULT 0,
                    used_by INTEGER,
                    created_at INTEGER DEFAULT (strftime('%s', 'now')),
                    used_at INTEGER
                )`
            },
            {
                name: 'message_templates',
                sql: `CREATE TABLE IF NOT EXISTS message_templates (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    name TEXT NOT NULL,
                    content TEXT NOT NULL,
                    image_url TEXT,
                    buttons_config TEXT,
                    created_at INTEGER DEFAULT (strftime('%s', 'now'))
                )`
            }
        ];
        
        // 创建所有表
        for (const table of tables) {
            try {
                db.exec(table.sql);
                console.log(`✅ 表 ${table.name} 创建/验证成功`);
            } catch (error) {
                console.log(`⚠️ 表 ${table.name} 创建失败: ${error.message}`);
            }
        }
        
        // 检查表结构
        const tableCheck = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();
        console.log(`✅ 数据库包含 ${tableCheck.length} 个表:`, tableCheck.map(t => t.name).join(', '));
        
        db.close();
        console.log('✅ 数据库初始化完成');
        return true;
        
    } catch (error) {
        console.error('❌ 数据库初始化失败:', error);
        return false;
    }
}

// 如果直接运行此脚本
if (require.main === module) {
    const success = initializeDatabase();
    process.exit(success ? 0 : 1);
}

module.exports = { initializeDatabase };
