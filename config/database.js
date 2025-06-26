const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

class DatabaseManager {
    constructor() {
        // 数据库路径配置 - 支持Railway Volume
        // 优先读取NODE_ENV，如果没有则读取Railway环境名称
        const nodeEnv = process.env.NODE_ENV || process.env.RAILWAY_ENVIRONMENT_NAME || 'development';
        const isProduction = nodeEnv === 'production';
        const isStaging = nodeEnv === 'staging';
        
        // 根据环境选择数据目录和数据库文件名
        // 生产环境和staging环境都优先使用Volume
        let dataDir;
        if (isProduction || isStaging) {
            // Railway Volume路径检查
            const volumeDataDir = process.env.RAILWAY_VOLUME_MOUNT_PATH || '/app/data';
            const localDataDir = path.join(__dirname, '..', 'data');
            
                        // 优先尝试使用Volume，无论是production还是staging
            try {
                if (fs.existsSync(volumeDataDir)) {
                    fs.accessSync(volumeDataDir, fs.constants.W_OK);
                    dataDir = volumeDataDir; // Volume可用
                    console.log(`📁 ${isStaging ? 'STAGING' : 'PRODUCTION'}环境使用Volume数据目录: ${dataDir}`);
                } else {
                    throw new Error('Volume目录不存在');
                }
            } catch (error) {
                console.log(`⚠️ Volume权限问题，使用本地目录: ${error.message}`);
                dataDir = localDataDir; // 使用本地目录
                console.log(`📁 使用本地数据目录: ${dataDir}`);
            }
        } else {
            dataDir = path.join(__dirname, '..', 'data');
        }
        
        // 不同环境使用不同的数据库文件
        let dbFileName;
        if (isProduction) {
            dbFileName = 'marketing_bot.db';
        } else if (isStaging) {
            // STAGING环境直接使用PRODUCTION数据库，实现一比一展现
            dbFileName = 'marketing_bot.db';
            console.log('🔄 STAGING环境配置为使用PRODUCTION数据库');
        } else {
            dbFileName = 'marketing_bot_dev.db';
        }
        
        this.dbPath = path.join(dataDir, dbFileName);
        
        console.log(`📊 数据库环境: ${nodeEnv}`);
        console.log(`📂 数据库路径: ${this.dbPath}`);
        
        this.ensureDataDirectory();
        
        // 尝试创建数据库连接
        try {
            console.log(`🔗 尝试连接数据库: ${this.dbPath}`);
            this.db = new Database(this.dbPath);
            console.log(`✅ 数据库连接成功`);
            this.db.pragma('journal_mode = WAL');
            this.initializeDatabase();
        } catch (error) {
            console.error(`❌ 数据库连接失败: ${error.message}`);
            console.error(`❌ 错误代码: ${error.code}`);
            console.error(`❌ 数据库路径: ${this.dbPath}`);
            
            // 检查数据库文件目录的详细信息
            const dataDir = path.dirname(this.dbPath);
            try {
                const stats = fs.statSync(dataDir);
                console.log(`📊 目录信息:`, {
                    exists: true,
                    isDirectory: stats.isDirectory(),
                    mode: stats.mode.toString(8),
                    uid: stats.uid,
                    gid: stats.gid
                });
            } catch (dirError) {
                console.error(`❌ 无法获取目录信息: ${dirError.message}`);
            }
            
            throw error;
        }
    }

    ensureDataDirectory() {
        const dataDir = path.dirname(this.dbPath);
        console.log(`🔍 检查数据目录: ${dataDir}`);
        
        if (!fs.existsSync(dataDir)) {
            console.log(`📁 创建数据目录: ${dataDir}`);
            try {
                fs.mkdirSync(dataDir, { recursive: true });
                console.log(`✅ 数据目录创建成功: ${dataDir}`);
            } catch (error) {
                console.error(`❌ 数据目录创建失败: ${error.message}`);
                throw error;
            }
        } else {
            console.log(`✅ 数据目录已存在: ${dataDir}`);
        }
        
        // 检查目录权限
        try {
            fs.accessSync(dataDir, fs.constants.W_OK);
            console.log(`✅ 数据目录具有写权限: ${dataDir}`);
        } catch (error) {
            console.error(`❌ 数据目录没有写权限: ${error.message}`);
            throw error;
        }
    }

    initializeDatabase() {
        console.log('初始化数据库...');
        
        // 创建数据库元信息表
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS db_meta (
                key TEXT PRIMARY KEY,
                value TEXT
            );
        `);

        // 检查并设置数据库版本
        const currentVersion = this.getDbVersion();
        console.log('当前数据库版本:', currentVersion);
        
        if (!currentVersion) {
            this.setDbVersion('1.1.2');
            this.createAllTables();
        } else {
            this.migrateDatabase(currentVersion);
        }

        // 设置管理员密码（如果不存在）
        this.initializeAdminPassword();
        
        console.log('数据库初始化完成');
    }

    getDbVersion() {
        try {
            const result = this.db.prepare('SELECT value FROM db_meta WHERE key = ?').get('db_version');
            return result ? result.value : null;
        } catch (error) {
            return null;
        }
    }

    setDbVersion(version) {
        this.db.prepare('INSERT OR REPLACE INTO db_meta (key, value) VALUES (?, ?)').run('db_version', version);
    }

    initializeAdminPassword() {
        try {
            const existingPassword = this.db.prepare('SELECT value FROM db_meta WHERE key = ?').get('admin_password');
            if (!existingPassword) {
                // 从环境变量获取管理员密码
                const adminPassword = process.env.ADMIN_PASSWORD;
                if (!adminPassword || adminPassword === 'your_admin_password_here') {
                    console.warn('⚠️ 警告：未设置管理员密码环境变量 ADMIN_PASSWORD');
                    console.warn('🔧 请设置环境变量或在Railway Variables中配置 ADMIN_PASSWORD');
                    console.warn('💡 本地开发：在.env文件中设置 ADMIN_PASSWORD=你的密码');
                    console.warn('☁️ Railway部署：在Variables页面设置 ADMIN_PASSWORD');
                    throw new Error('管理员密码未配置，请设置 ADMIN_PASSWORD 环境变量');
                }
                this.db.prepare('INSERT OR REPLACE INTO db_meta (key, value) VALUES (?, ?)').run('admin_password', adminPassword);
                console.log('✅ 管理员密码已从环境变量初始化');
            }
        } catch (error) {
            console.error('❌ 初始化管理员密码失败:', error.message);
            throw error;
        }
    }

    createAllTables() {
        console.log('创建所有数据表...');
        
        // 绑定码表
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS bind_codes (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                code TEXT UNIQUE NOT NULL,
                description TEXT,
                used INTEGER DEFAULT 0,
                used_by INTEGER,
                created_at INTEGER DEFAULT (strftime('%s', 'now')),
                used_at INTEGER
            );
        `);

        // 地区表
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS regions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                sort_order INTEGER DEFAULT 0,
                active INTEGER DEFAULT 1,
                created_at INTEGER DEFAULT (strftime('%s', 'now'))
            );
        `);

        // 商家表
        this.db.exec(`
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
                advantages TEXT,
                disadvantages TEXT,
                price1 INTEGER,
                price2 INTEGER,
                skill_wash TEXT,
                skill_blow TEXT,
                skill_do TEXT,
                skill_kiss TEXT,
                channel_link TEXT,
                channel_clicks INTEGER DEFAULT 0,
                image_url TEXT,
                FOREIGN KEY (region_id) REFERENCES regions (id)
            );
        `);

        // 频道点击记录表
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS channel_clicks (
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

        // 按钮表
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS buttons (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                title TEXT NOT NULL,
                message TEXT,
                merchant_id INTEGER,
                active INTEGER DEFAULT 1,
                click_count INTEGER DEFAULT 0,
                created_at INTEGER DEFAULT (strftime('%s', 'now')),
                FOREIGN KEY (merchant_id) REFERENCES merchants (id)
            );
        `);

        // 消息模板表
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS message_templates (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                content TEXT NOT NULL,
                image_url TEXT,
                buttons_config TEXT,
                created_at INTEGER DEFAULT (strftime('%s', 'now'))
            );
        `);

        // 触发词表
        this.db.exec(`
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
            );
        `);

        // 定时任务表
        this.db.exec(`
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
            );
        `);

        // 交互记录表
        this.db.exec(`
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
            );
        `);

        // 预约会话表
        this.db.exec(`
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
            );
        `);

        // 评价表
        this.db.exec(`
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
            );
        `);

        // 评价会话表
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS evaluation_sessions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                evaluation_id INTEGER NOT NULL,
                current_step TEXT DEFAULT 'start',
                temp_data TEXT,
                created_at INTEGER DEFAULT (strftime('%s', 'now')),
                updated_at INTEGER DEFAULT (strftime('%s', 'now')),
                FOREIGN KEY (evaluation_id) REFERENCES evaluations (id)
            );
        `);

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
        
        // 检查是否需要添加新字段到regions表
        this.migrateRegionsTable();
        
        // 检查是否需要添加新字段到merchants表
        this.migrateMerchantsTable();
        
        // 检查是否需要创建orders表
        this.migrateOrdersTable();
        
        // 检查是否需要创建channel_clicks表
        this.migrateChannelClicksTable();
        
        // 新增：强制修复数据一致性问题（针对显示都是2的问题）
        this.repairDataConsistency();
        
        // 更新到最新版本
        this.setDbVersion('1.1.3'); // 升级版本号，强制触发active字段迁移
        console.log('数据库迁移完成');
    }

    migrateRegionsTable() {
        try {
            // 检查regions表是否存在active字段
            const tableInfo = this.db.prepare("PRAGMA table_info(regions)").all();
            const columnNames = tableInfo.map(col => col.name);
            
            if (!columnNames.includes('active')) {
                console.log('添加字段 active 到 regions 表');
                this.db.exec('ALTER TABLE regions ADD COLUMN active INTEGER DEFAULT 1');
                
                // 更新所有现有记录的active字段为1
                const updateResult = this.db.prepare('UPDATE regions SET active = 1 WHERE active IS NULL').run();
                console.log(`✅ 已添加active字段并更新了 ${updateResult.changes} 条记录`);
            }
        } catch (error) {
            console.error('迁移regions表失败:', error);
        }
    }

    migrateMerchantsTable() {
        try {
            // 检查merchants表是否存在新字段
            const tableInfo = this.db.prepare("PRAGMA table_info(merchants)").all();
            const columnNames = tableInfo.map(col => col.name);
            
            const requiredColumns = ['advantages', 'disadvantages', 'price1', 'price2', 'skill_wash', 'skill_blow', 'skill_do', 'skill_kiss', 'channel_link', 'channel_clicks', 'image_url'];
            
            for (const column of requiredColumns) {
                if (!columnNames.includes(column)) {
                    console.log(`添加字段 ${column} 到 merchants 表`);
                    if (column.startsWith('price') || column === 'channel_clicks') {
                        this.db.exec(`ALTER TABLE merchants ADD COLUMN ${column} INTEGER DEFAULT 0`);
                    } else {
                        this.db.exec(`ALTER TABLE merchants ADD COLUMN ${column} TEXT`);
                    }
                }
            }
        } catch (error) {
            console.error('迁移merchants表失败:', error);
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
                console.log('channel_clicks表创建完成');
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
    }
}

// 创建简单的内存缓存
class SimpleCache {
    constructor() {
        this.cache = new Map();
    }
    
    get(key) {
        const item = this.cache.get(key);
        if (!item) return null;
        
        if (Date.now() > item.expiry) {
            this.cache.delete(key);
            return null;
        }
        
        return item.data;
    }
    
    set(key, data, ttl = 5 * 60 * 1000) { // 默认5分钟过期
        if (data === null || data === undefined) {
            this.cache.delete(key);
            return;
        }
        
        this.cache.set(key, {
            data: data,
            expiry: Date.now() + ttl
        });
    }
    
    clear() {
        this.cache.clear();
    }
}

// 创建单例实例
const dbManager = new DatabaseManager();
const cache = new SimpleCache();

module.exports = {
    db: dbManager.getDatabase(),
    dbManager: dbManager,
    cache: cache,
    close: () => dbManager.close()
};