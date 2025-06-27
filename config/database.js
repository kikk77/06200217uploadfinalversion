const Database = require('better-sqlite3');
const path = require('path');

// 数据库路径配置 - 支持多环境和Railway Volume
const nodeEnv = process.env.NODE_ENV || 'development';
const isProduction = nodeEnv === 'production';
const isStaging = nodeEnv === 'staging';
const isDeployment = isProduction || isStaging;

// 数据库文件名根据环境区分
const dbFileName = isStaging ? 'marketing_bot_staging.db' : 'marketing_bot.db';
const dataDir = isDeployment ? '/app/data' : path.join(__dirname, '..', 'data');
const dbPath = path.join(dataDir, dbFileName);

console.log(`📊 数据库环境: ${nodeEnv}`);
console.log(`🏷️ 数据库文件: ${dbFileName}`);
console.log(`📂 数据库路径: ${dbPath}`);

// 确保data目录存在
const fs = require('fs');
if (!fs.existsSync(dataDir)) {
    console.log(`📁 创建数据目录: ${dataDir}`);
    fs.mkdirSync(dataDir, { recursive: true });
}

// 检查数据库是否已存在
const dbExists = fs.existsSync(dbPath);
console.log(`💾 数据库状态: ${dbExists ? '已存在' : '将创建新数据库'}`);

// 数据库性能优化配置
const db = new Database(dbPath, {
    fileMustExist: false
});

// 性能优化设置 - 添加错误处理
try {
db.pragma('journal_mode = WAL');
db.pragma('synchronous = NORMAL');
db.pragma('cache_size = 1000');
db.pragma('temp_store = memory');
db.pragma('mmap_size = 268435456'); // 256MB
    console.log('✅ 数据库性能优化设置完成');
} catch (error) {
    console.warn('⚠️ 数据库性能优化设置失败，使用默认设置:', error.message);
}

// 内存缓存层
const cache = new Map();
const CACHE_TTL = 5 * 60 * 1000; // 5分钟缓存
const CACHE_CHECK_INTERVAL = 60 * 1000; // 每分钟清理一次过期缓存

// 缓存管理函数
function setCache(key, value, ttl = CACHE_TTL) {
    cache.set(key, {
        value,
        expires: Date.now() + ttl
    });
}

function getCache(key) {
    const item = cache.get(key);
    if (!item) return null;
    
    if (Date.now() > item.expires) {
        cache.delete(key);
        return null;
    }
    
    return item.value;
}

function clearExpiredCache() {
    const now = Date.now();
    for (const [key, item] of cache.entries()) {
        if (now > item.expires) {
            cache.delete(key);
        }
    }
}

// 定期清理过期缓存
setInterval(clearExpiredCache, CACHE_CHECK_INTERVAL);

// 预编译语句缓存
const preparedStatements = new Map();

function getPreparedStatement(sql) {
    if (!preparedStatements.has(sql)) {
        preparedStatements.set(sql, db.prepare(sql));
    }
    return preparedStatements.get(sql);
}

// 创建数据库表
function initDatabase() {
    console.log('🔧 开始初始化数据库表结构...');
    
    // 检查数据库版本（用于数据迁移）
    try {
        db.exec(`
            CREATE TABLE IF NOT EXISTS db_meta (
                key TEXT PRIMARY KEY,
                value TEXT
            )
        `);
        
        const currentVersion = db.prepare('SELECT value FROM db_meta WHERE key = ?').get('db_version')?.value || '1.0.0';
        console.log(`📋 当前数据库版本: ${currentVersion}`);
        
        // 设置或更新数据库版本
        db.prepare('INSERT OR REPLACE INTO db_meta (key, value) VALUES (?, ?)').run('db_version', '1.1.0');
    } catch (error) {
        console.warn('⚠️ 数据库版本检查失败:', error.message);
    }
    
    // 绑定码表
    db.exec(`
        CREATE TABLE IF NOT EXISTS bind_codes (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            code TEXT UNIQUE NOT NULL,
            description TEXT,
            used INTEGER DEFAULT 0,
            used_by INTEGER,
            created_at INTEGER DEFAULT (strftime('%s', 'now')),
            used_at INTEGER
        )
    `);

    // 地区配置表
    db.exec(`
        CREATE TABLE IF NOT EXISTS regions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            sort_order INTEGER DEFAULT 0,
            active INTEGER DEFAULT 1
        )
    `);

    // 商家表（扩展版本）
    db.exec(`
        CREATE TABLE IF NOT EXISTS merchants (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER UNIQUE,
            username TEXT,
            teacher_name TEXT,
            region_id INTEGER,
            contact TEXT,
            bind_code TEXT,
            bind_step INTEGER DEFAULT 0,
            bind_data TEXT,
            status TEXT DEFAULT 'active',
            created_at INTEGER DEFAULT (strftime('%s', 'now')),
            FOREIGN KEY (region_id) REFERENCES regions (id)
        )
    `);

    // 检查并添加缺失的列
    try {
        db.exec(`ALTER TABLE merchants ADD COLUMN teacher_name TEXT`);
    } catch (e) { /* 列已存在 */ }
    
    try {
        db.exec(`ALTER TABLE merchants ADD COLUMN region_id INTEGER`);
    } catch (e) { /* 列已存在 */ }
    
    try {
        db.exec(`ALTER TABLE merchants ADD COLUMN bind_step INTEGER DEFAULT 0`);
    } catch (e) { /* 列已存在 */ }
    
    try {
        db.exec(`ALTER TABLE merchants ADD COLUMN bind_data TEXT`);
    } catch (e) { /* 列已存在 */ }
    
    try {
        db.exec(`ALTER TABLE merchants ADD COLUMN status TEXT DEFAULT 'active'`);
    } catch (e) { /* 列已存在 */ }

    // 添加信息模板相关字段
    try {
        db.exec(`ALTER TABLE merchants ADD COLUMN advantages TEXT`);
    } catch (e) { /* 列已存在 */ }
    
    try {
        db.exec(`ALTER TABLE merchants ADD COLUMN disadvantages TEXT`);
    } catch (e) { /* 列已存在 */ }
    
    try {
        db.exec(`ALTER TABLE merchants ADD COLUMN price1 INTEGER`);
    } catch (e) { /* 列已存在 */ }
    
    try {
        db.exec(`ALTER TABLE merchants ADD COLUMN price2 INTEGER`);
    } catch (e) { /* 列已存在 */ }
    
    try {
        db.exec(`ALTER TABLE merchants ADD COLUMN skill_wash TEXT`);
    } catch (e) { /* 列已存在 */ }
    
    try {
        db.exec(`ALTER TABLE merchants ADD COLUMN skill_blow TEXT`);
    } catch (e) { /* 列已存在 */ }
    
    try {
        db.exec(`ALTER TABLE merchants ADD COLUMN skill_do TEXT`);
    } catch (e) { /* 列已存在 */ }
    
    try {
        db.exec(`ALTER TABLE merchants ADD COLUMN skill_kiss TEXT`);
    } catch (e) { /* 列已存在 */ }

    // 按钮表
    db.exec(`
        CREATE TABLE IF NOT EXISTS buttons (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            title TEXT NOT NULL,
            message TEXT,
            merchant_id INTEGER,
            active INTEGER DEFAULT 1,
            click_count INTEGER DEFAULT 0,
            created_at INTEGER DEFAULT (strftime('%s', 'now')),
            FOREIGN KEY (merchant_id) REFERENCES merchants (id)
        )
    `);

    // 消息模板表
    db.exec(`
        CREATE TABLE IF NOT EXISTS message_templates (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            content TEXT NOT NULL,
            image_url TEXT,
            buttons_config TEXT,
            created_at INTEGER DEFAULT (strftime('%s', 'now'))
        )
    `);

    // 触发词表
    db.exec(`
        CREATE TABLE IF NOT EXISTS trigger_words (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            word TEXT NOT NULL,
            template_id INTEGER,
            match_type TEXT DEFAULT 'exact',
            chat_id INTEGER NOT NULL,
            active INTEGER DEFAULT 1,
            trigger_count INTEGER DEFAULT 0,
            last_triggered INTEGER DEFAULT 0,
            created_at INTEGER DEFAULT (strftime('%s', 'now')),
            FOREIGN KEY (template_id) REFERENCES message_templates (id)
        )
    `);

    // 定时任务表
    db.exec(`
        CREATE TABLE IF NOT EXISTS scheduled_tasks (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            template_id INTEGER,
            chat_id INTEGER NOT NULL,
            schedule_type TEXT NOT NULL,
            schedule_time TEXT NOT NULL,
            sequence_order INTEGER DEFAULT 0,
            sequence_delay INTEGER DEFAULT 0,
            active INTEGER DEFAULT 1,
            next_run INTEGER,
            last_run INTEGER,
            created_at INTEGER DEFAULT (strftime('%s', 'now')),
            FOREIGN KEY (template_id) REFERENCES message_templates (id)
        )
    `);

    // 用户交互日志表
    db.exec(`
        CREATE TABLE IF NOT EXISTS interactions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            username TEXT,
            first_name TEXT,
            last_name TEXT,
            button_id INTEGER,
            template_id INTEGER,
            action_type TEXT DEFAULT 'click',
            chat_id INTEGER,
            timestamp INTEGER DEFAULT (strftime('%s', 'now')),
            FOREIGN KEY (button_id) REFERENCES buttons (id),
            FOREIGN KEY (template_id) REFERENCES message_templates (id)
        )
    `);

    // 添加新字段到现有的interactions表
    try {
        db.exec(`ALTER TABLE interactions ADD COLUMN first_name TEXT`);
    } catch (e) { /* 列已存在 */ }
    
    try {
        db.exec(`ALTER TABLE interactions ADD COLUMN last_name TEXT`);
    } catch (e) { /* 列已存在 */ }

    // 预约状态跟踪表
    db.exec(`
        CREATE TABLE IF NOT EXISTS booking_sessions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            merchant_id INTEGER NOT NULL,
            course_type TEXT NOT NULL,
            status TEXT DEFAULT 'notified',
            user_course_status TEXT DEFAULT 'pending',
            merchant_course_status TEXT DEFAULT 'pending',
            created_at INTEGER DEFAULT (strftime('%s', 'now')),
            updated_at INTEGER DEFAULT (strftime('%s', 'now'))
        )
    `);

    // 添加新字段到现有的booking_sessions表
    try {
        db.exec(`ALTER TABLE booking_sessions ADD COLUMN user_course_status TEXT DEFAULT 'pending'`);
    } catch (e) { /* 列已存在 */ }
    
    try {
        db.exec(`ALTER TABLE booking_sessions ADD COLUMN merchant_course_status TEXT DEFAULT 'pending'`);
    } catch (e) { /* 列已存在 */ }

    // 评价表
    db.exec(`
        CREATE TABLE IF NOT EXISTS evaluations (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            booking_session_id INTEGER NOT NULL,
            evaluator_type TEXT NOT NULL,
            evaluator_id INTEGER NOT NULL,
            target_id INTEGER NOT NULL,
            overall_score INTEGER,
            detailed_scores TEXT,
            comments TEXT,
            status TEXT DEFAULT 'pending',
            created_at INTEGER DEFAULT (strftime('%s', 'now')),
            FOREIGN KEY (booking_session_id) REFERENCES booking_sessions (id)
        )
    `);

    // 用户评价状态跟踪表
    db.exec(`
        CREATE TABLE IF NOT EXISTS evaluation_sessions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            evaluation_id INTEGER NOT NULL,
            current_step TEXT DEFAULT 'start',
            temp_data TEXT,
            created_at INTEGER DEFAULT (strftime('%s', 'now')),
            updated_at INTEGER DEFAULT (strftime('%s', 'now')),
            FOREIGN KEY (evaluation_id) REFERENCES evaluations (id)
        )
    `);

    // 订单管理表
    db.exec(`
        CREATE TABLE IF NOT EXISTS orders (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            booking_session_id INTEGER NOT NULL,
            user_id INTEGER NOT NULL,
            user_name TEXT NOT NULL,
            user_username TEXT,
            merchant_id INTEGER NOT NULL,
            teacher_name TEXT NOT NULL,
            teacher_contact TEXT,
            course_content TEXT NOT NULL,
            price TEXT,
            booking_time TEXT NOT NULL,
            status TEXT DEFAULT 'confirmed',
            user_evaluation TEXT,
            merchant_evaluation TEXT,
            report_content TEXT,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            FOREIGN KEY (booking_session_id) REFERENCES booking_sessions (id),
            FOREIGN KEY (merchant_id) REFERENCES merchants (id)
        )
    `);

<<<<<<< Updated upstream
    console.log('✅ 数据库表初始化完成');
    
    // 显示数据库统计信息
    try {
        const tableCount = db.prepare("SELECT COUNT(*) as count FROM sqlite_master WHERE type='table'").get().count;
        const dbSize = fs.statSync(dbPath).size;
        console.log(`📊 数据库统计: ${tableCount}个表, 文件大小: ${(dbSize / 1024).toFixed(1)}KB`);
    } catch (error) {
        console.warn('⚠️ 获取数据库统计信息失败:', error.message);
=======
        // 订单表 - 完整版本
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS orders (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                order_number TEXT UNIQUE NOT NULL DEFAULT ('ORD' || strftime('%Y%m%d%H%M%S', 'now') || substr(abs(random()), 1, 3)),
                booking_session_id TEXT,
                user_id INTEGER NOT NULL,
                user_name TEXT,
                user_username TEXT,
                merchant_id INTEGER NOT NULL,
                merchant_user_id INTEGER,
                teacher_name TEXT,
                teacher_contact TEXT,
                region_id INTEGER,
                course_type TEXT CHECK(course_type IN ('p', 'pp', 'other')),
                course_content TEXT,
                price_range TEXT,
                actual_price INTEGER,
                status TEXT CHECK(status IN ('attempting', 'pending', 'confirmed', 'completed', 'cancelled', 'failed')) DEFAULT 'attempting',
                booking_time INTEGER,
                confirmed_time INTEGER,
                completed_time INTEGER,
                user_evaluation_id INTEGER,
                merchant_evaluation_id INTEGER,
                user_evaluation TEXT,
                merchant_evaluation TEXT,
                report_content TEXT,
                created_at INTEGER DEFAULT (strftime('%s', 'now')),
                updated_at INTEGER DEFAULT (strftime('%s', 'now')),
                FOREIGN KEY (merchant_id) REFERENCES merchants(id),
                FOREIGN KEY (region_id) REFERENCES regions(id)
            );
        `);

        console.log('所有数据表创建完成');
    }

    migrateDatabase(currentVersion) {
        console.log(`开始数据库迁移，当前版本: ${currentVersion}`);
        
        // 检查是否需要添加新字段到merchants表
        this.migrateMerchantsTable();
        
        // 检查是否需要创建orders表
        this.migrateOrdersTable();
        
        // 检查是否需要创建channel_clicks表
        this.migrateChannelClicksTable();
        
        // 新增：强制修复数据一致性问题（针对显示都是2的问题）
        this.repairDataConsistency();
        
        // 更新到最新版本
        this.setDbVersion('1.1.2'); // 升级版本号，强制触发image_url字段迁移
        console.log('数据库迁移完成');
    }

    migrateMerchantsTable() {
        try {
            console.log('🔧 检查merchants表字段...');
            
            // 检查表结构
            const columns = this.db.prepare("PRAGMA table_info(merchants)").all();
            const columnNames = columns.map(col => col.name);
            
            console.log('当前merchants表字段:', columnNames);
            
            // 需要检查的字段列表 - 按照实际数据库定义的顺序
            const requiredFields = ['advantages', 'disadvantages', 'price1', 'price2', 
                                  'skill_wash', 'skill_blow', 'skill_do', 'skill_kiss', 
                                  'channel_link', 'channel_clicks', 'image_url'];
            
            // 添加缺失的字段
            for (const field of requiredFields) {
                if (!columnNames.includes(field)) {
                    console.log(`🔧 添加缺失字段: ${field}`);
                    try {
                        if (field.startsWith('price') || field === 'channel_clicks') {
                            this.db.exec(`ALTER TABLE merchants ADD COLUMN ${field} INTEGER DEFAULT 0`);
                        } else {
                            this.db.exec(`ALTER TABLE merchants ADD COLUMN ${field} TEXT`);
                        }
                        console.log(`✅ 成功添加字段: ${field}`);
                    } catch (error) {
                        if (!error.message.includes('duplicate column name')) {
                            console.error(`❌ 添加字段 ${field} 失败:`, error);
                        } else {
                            console.log(`⚠️ 字段 ${field} 已存在，跳过添加`);
                        }
                    }
                }
            }
            
            console.log('✅ merchants表字段迁移完成');
            
        } catch (error) {
            console.error('❌ 迁移merchants表失败:', error);
        }
    }

    migrateOrdersTable() {
        try {
            // 检查orders表是否存在
            const tablesResult = this.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='orders'").get();
            
            if (!tablesResult) {
                console.log('创建orders表...');
                this.db.exec(`
                    CREATE TABLE orders (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        order_number TEXT UNIQUE NOT NULL DEFAULT ('ORD' || strftime('%Y%m%d%H%M%S', 'now') || substr(abs(random()), 1, 3)),
                        booking_session_id TEXT,
                        user_id INTEGER NOT NULL,
                        user_name TEXT,
                        user_username TEXT,
                        merchant_id INTEGER NOT NULL,
                        merchant_user_id INTEGER,
                        teacher_name TEXT,
                        teacher_contact TEXT,
                        region_id INTEGER,
                        course_type TEXT CHECK(course_type IN ('p', 'pp', 'other')),
                        course_content TEXT,
                        price_range TEXT,
                        actual_price INTEGER,
                        status TEXT CHECK(status IN ('attempting', 'pending', 'confirmed', 'completed', 'cancelled', 'failed')) DEFAULT 'attempting',
                        booking_time INTEGER,
                        confirmed_time INTEGER,
                        completed_time INTEGER,
                        user_evaluation_id INTEGER,
                        merchant_evaluation_id INTEGER,
                        user_evaluation TEXT,
                        merchant_evaluation TEXT,
                        report_content TEXT,
                        created_at INTEGER DEFAULT (strftime('%s', 'now')),
                        updated_at INTEGER DEFAULT (strftime('%s', 'now')),
                        FOREIGN KEY (merchant_id) REFERENCES merchants(id),
                        FOREIGN KEY (region_id) REFERENCES regions(id)
                    );
                `);
                console.log('orders表创建完成');
            } else {
                // 检查现有orders表是否需要添加新字段
                const tableInfo = this.db.prepare("PRAGMA table_info(orders)").all();
                const columnNames = tableInfo.map(col => col.name);
                
                const requiredColumns = [
                    'merchant_user_id', 'course_type', 'price_range', 'teacher_contact',
                    'user_name', 'user_username', 'teacher_name', 'course_content',
                    'actual_price', 'booking_time', 'confirmed_time', 'completed_time',
                    'user_evaluation_id', 'merchant_evaluation_id', 'user_evaluation',
                    'merchant_evaluation', 'report_content', 'updated_at'
                ];
                
                for (const column of requiredColumns) {
                    if (!columnNames.includes(column)) {
                        console.log(`添加字段 ${column} 到 orders 表`);
                        if (column.includes('_id') || column.includes('price') || column.includes('time')) {
                            this.db.exec(`ALTER TABLE orders ADD COLUMN ${column} INTEGER`);
                        } else {
                            this.db.exec(`ALTER TABLE orders ADD COLUMN ${column} TEXT`);
                        }
                    }
                }
                
                // 修改booking_session_id允许为空（如果需要）
                try {
                    this.db.exec(`
                        CREATE TABLE IF NOT EXISTS orders_new (
                            id INTEGER PRIMARY KEY AUTOINCREMENT,
                            order_number TEXT UNIQUE NOT NULL DEFAULT ('ORD' || strftime('%Y%m%d%H%M%S', 'now') || substr(abs(random()), 1, 3)),
                            booking_session_id TEXT,
                            user_id INTEGER NOT NULL,
                            user_name TEXT,
                            user_username TEXT,
                            merchant_id INTEGER NOT NULL,
                            merchant_user_id INTEGER,
                            teacher_name TEXT,
                            teacher_contact TEXT,
                            region_id INTEGER,
                            course_type TEXT CHECK(course_type IN ('p', 'pp', 'other')),
                            course_content TEXT,
                            price_range TEXT,
                            actual_price INTEGER,
                            status TEXT CHECK(status IN ('attempting', 'pending', 'confirmed', 'completed', 'cancelled', 'failed')) DEFAULT 'attempting',
                            booking_time INTEGER,
                            confirmed_time INTEGER,
                            completed_time INTEGER,
                            user_evaluation_id INTEGER,
                            merchant_evaluation_id INTEGER,
                            user_evaluation TEXT,
                            merchant_evaluation TEXT,
                            report_content TEXT,
                            created_at INTEGER DEFAULT (strftime('%s', 'now')),
                            updated_at INTEGER DEFAULT (strftime('%s', 'now')),
                            FOREIGN KEY (merchant_id) REFERENCES merchants(id),
                            FOREIGN KEY (region_id) REFERENCES regions(id)
                        );
                    `);
                    
                    // 复制现有数据
                    this.db.exec(`
                        INSERT INTO orders_new SELECT 
                            id, order_number, booking_session_id, user_id, user_name, user_username,
                            merchant_id, merchant_user_id, teacher_name, teacher_contact, region_id,
                            course_type, course_content, price_range, actual_price, status,
                            booking_time, confirmed_time, completed_time, user_evaluation_id,
                            merchant_evaluation_id, user_evaluation, merchant_evaluation, report_content,
                            created_at, updated_at
                        FROM orders;
                    `);
                    
                    // 删除旧表，重命名新表
                    this.db.exec('DROP TABLE orders;');
                    this.db.exec('ALTER TABLE orders_new RENAME TO orders;');
                    
                    console.log('orders表结构更新完成');
                } catch (error) {
                    console.log('orders表结构已是最新版本');
                }
            }
        } catch (error) {
            console.error('迁移orders表失败:', error);
        }
    }

    migrateChannelClicksTable() {
        try {
            // 检查channel_clicks表是否存在
            const tablesResult = this.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='channel_clicks'").get();
            
            if (!tablesResult) {
                console.log('创建channel_clicks表...');
                this.db.exec(`
                    CREATE TABLE channel_clicks (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        user_id INTEGER NOT NULL,
                        username TEXT,
                        first_name TEXT,
                        last_name TEXT,
                        merchant_id INTEGER NOT NULL,
                        merchant_name TEXT,
                        channel_link TEXT,
                        clicked_at INTEGER DEFAULT (strftime('%s', 'now')),
                        FOREIGN KEY (merchant_id) REFERENCES merchants (id)
                    );
                `);
                console.log('✅ channel_clicks表创建完成');
            } else {
                console.log('channel_clicks表已存在，跳过创建');
            }
        } catch (error) {
            console.error('迁移channel_clicks表失败:', error);
        }
    }

    // 新增：修复数据一致性问题
    repairDataConsistency() {
        console.log('🔧 修复数据一致性问题...');
        
        try {
            // 1. 确保所有商家都有正确的状态
            const merchantsWithoutStatus = this.db.prepare(`
                SELECT id, teacher_name FROM merchants WHERE status IS NULL OR status = ''
            `).all();
            
            if (merchantsWithoutStatus.length > 0) {
                console.log(`修复 ${merchantsWithoutStatus.length} 个商家的状态`);
                const updateMerchantStatus = this.db.prepare('UPDATE merchants SET status = ? WHERE id = ?');
                for (const merchant of merchantsWithoutStatus) {
                    updateMerchantStatus.run('active', merchant.id);
                }
            }
            
            // 2. 确保所有订单都有正确的状态
            const ordersWithoutStatus = this.db.prepare(`
                SELECT id, order_number FROM orders WHERE status IS NULL OR status = ''
            `).all();
            
            if (ordersWithoutStatus.length > 0) {
                console.log(`修复 ${ordersWithoutStatus.length} 个订单的状态`);
                const updateOrderStatus = this.db.prepare('UPDATE orders SET status = ? WHERE id = ?');
                for (const order of ordersWithoutStatus) {
                    updateOrderStatus.run('pending', order.id);
                }
            }
            
            // 3. 重新计算并缓存统计数据
            this.refreshStatisticsCache();
            
            console.log('✅ 数据一致性修复完成');
            
        } catch (error) {
            console.error('数据一致性修复失败:', error);
        }
    }

    // 新增：刷新统计缓存
    refreshStatisticsCache() {
        try {
            console.log('🔄 刷新统计缓存...');
            
            // 清理可能存在的缓存表
            const statsTables = ['order_stats', 'merchant_ratings', 'user_ratings'];
            for (const table of statsTables) {
                try {
                    this.db.exec(`DELETE FROM ${table}`);
                } catch (error) {
                    // 表可能不存在，忽略错误
                }
            }
            
            // 强制触发统计重新计算
            const totalMerchants = this.db.prepare('SELECT COUNT(*) as count FROM merchants').get().count;
            const activeMerchants = this.db.prepare("SELECT COUNT(*) as count FROM merchants WHERE status = 'active'").get().count;
            const totalOrders = this.db.prepare('SELECT COUNT(*) as count FROM orders').get().count;
            const completedOrders = this.db.prepare("SELECT COUNT(*) as count FROM orders WHERE status = 'completed'").get().count;
            
            console.log(`统计验证: 商家总数=${totalMerchants}, 活跃商家=${activeMerchants}, 订单总数=${totalOrders}, 完成订单=${completedOrders}`);
            
            // 将统计数据存储到元数据表，供前端快速读取
            this.db.prepare('INSERT OR REPLACE INTO db_meta (key, value) VALUES (?, ?)').run('stats_merchants_total', totalMerchants.toString());
            this.db.prepare('INSERT OR REPLACE INTO db_meta (key, value) VALUES (?, ?)').run('stats_merchants_active', activeMerchants.toString());
            this.db.prepare('INSERT OR REPLACE INTO db_meta (key, value) VALUES (?, ?)').run('stats_orders_total', totalOrders.toString());
            this.db.prepare('INSERT OR REPLACE INTO db_meta (key, value) VALUES (?, ?)').run('stats_orders_completed', completedOrders.toString());
            this.db.prepare('INSERT OR REPLACE INTO db_meta (key, value) VALUES (?, ?)').run('stats_last_update', Date.now().toString());
            
            console.log('✅ 统计缓存刷新完成');
            
        } catch (error) {
            console.error('统计缓存刷新失败:', error);
        }
    }

    // 获取管理员密码
    getAdminPassword() {
        try {
            const result = this.db.prepare('SELECT value FROM db_meta WHERE key = ?').get('admin_password');
            if (!result || !result.value) {
                throw new Error('管理员密码未设置，请配置 ADMIN_PASSWORD 环境变量');
            }
            return result.value;
        } catch (error) {
            console.error('获取管理员密码失败:', error.message);
            throw error;
        }
    }

    // 验证管理员密码
    verifyAdminPassword(password) {
        const adminPassword = this.getAdminPassword();
        return password === adminPassword;
    }

    getDatabase() {
        return this.db;
    }

    close() {
        if (this.db) {
            this.db.close();
        }
>>>>>>> Stashed changes
    }
}

// 调用初始化函数
initDatabase();

module.exports = {
    db,
    initDatabase,
    cache: {
        set: setCache,
        get: getCache,
        clear: () => cache.clear(),
        size: () => cache.size
    },
    getPreparedStatement
}; 