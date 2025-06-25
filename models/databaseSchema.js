const Database = require('better-sqlite3');
const path = require('path');

// 数据库结构管理模块
class DatabaseSchema {
    constructor() {
        this.dbPath = path.join(__dirname, '../data');
        this.ensureDataDirectory();
        
        // 核心数据库（持久化数据）
        this.coreDb = new Database(path.join(this.dbPath, 'core.db'));
        
        // 模板和配置数据库
        this.templateDb = new Database(path.join(this.dbPath, 'templates.db'));
        
        // 当前月份的用户数据库
        this.currentUserDb = this.getUserDatabase();
        
        this.initializeDatabases();
    }

    // 确保数据目录存在
    ensureDataDirectory() {
        const fs = require('fs');
        if (!fs.existsSync(this.dbPath)) {
            fs.mkdirSync(this.dbPath, { recursive: true });
        }
    }

    // 获取当前月份的用户数据库
    getUserDatabase(date = new Date()) {
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const dbName = `users_${year}_${month}.db`;
        return new Database(path.join(this.dbPath, dbName));
    }

    // 初始化所有数据库表结构
    initializeDatabases() {
        this.initializeCoreDatabase();
        this.initializeTemplateDatabase();
        this.initializeUserDatabase(this.currentUserDb);
        
        console.log('数据库结构初始化完成');
    }

    // 初始化核心数据库（地区、绑定码、商家基本信息）
    initializeCoreDatabase() {
        // 地区表
        this.coreDb.exec(`
            CREATE TABLE IF NOT EXISTS regions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL UNIQUE,
                sort_order INTEGER DEFAULT 0,
                active INTEGER DEFAULT 1,
                created_at INTEGER DEFAULT (strftime('%s', 'now')),
                updated_at INTEGER DEFAULT (strftime('%s', 'now'))
            )
        `);

        // 绑定码表
        this.coreDb.exec(`
            CREATE TABLE IF NOT EXISTS bind_codes (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                code TEXT NOT NULL UNIQUE,
                description TEXT,
                used BOOLEAN DEFAULT 0,
                used_by_user_id INTEGER,
                used_by_username TEXT,
                created_at INTEGER DEFAULT (strftime('%s', 'now')),
                used_at INTEGER
            )
        `);

        // 商家基本信息表
        this.coreDb.exec(`
            CREATE TABLE IF NOT EXISTS merchants (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL UNIQUE,
                username TEXT,
                first_name TEXT,
                last_name TEXT,
                region_id INTEGER,
                teacher_name TEXT,
                contact TEXT,
                bind_code TEXT,
                bind_step INTEGER DEFAULT 0,
                status TEXT DEFAULT 'inactive',
                price1 INTEGER,
                price2 INTEGER,
                advantages TEXT,
                disadvantages TEXT,
                skill_wash TEXT,
                skill_blow TEXT,
                skill_do TEXT,
                skill_kiss TEXT,
                created_at INTEGER DEFAULT (strftime('%s', 'now')),
                updated_at INTEGER DEFAULT (strftime('%s', 'now')),
                FOREIGN KEY (region_id) REFERENCES regions (id)
            )
        `);

        // 预约会话表（核心流程数据）
        this.coreDb.exec(`
            CREATE TABLE IF NOT EXISTS booking_sessions (
                id TEXT PRIMARY KEY,
                user_id INTEGER NOT NULL,
                merchant_id INTEGER NOT NULL,
                course_type TEXT NOT NULL,
                status TEXT DEFAULT 'pending',
                user_course_status TEXT DEFAULT 'pending',
                merchant_course_status TEXT DEFAULT 'pending',
                created_at INTEGER DEFAULT (strftime('%s', 'now')),
                completed_at INTEGER,
                FOREIGN KEY (merchant_id) REFERENCES merchants (id)
            )
        `);

        // 订单表 - 完整业务数据
        this.coreDb.exec(`
            CREATE TABLE IF NOT EXISTS orders (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                order_number TEXT UNIQUE NOT NULL,
                booking_session_id TEXT,
                user_id INTEGER NOT NULL,
                user_name TEXT,
                user_username TEXT,
                merchant_id INTEGER NOT NULL,
                merchant_user_id INTEGER NOT NULL,
                teacher_name TEXT,
                teacher_contact TEXT,
                region_id INTEGER,
                course_type TEXT CHECK(course_type IN ('p', 'pp', 'other')),
                course_content TEXT,
                price_range TEXT,
                actual_price INTEGER,
                status TEXT CHECK(status IN ('pending', 'confirmed', 'completed', 'cancelled')) DEFAULT 'pending',
                booking_time INTEGER,
                confirmed_time INTEGER,
                completed_time INTEGER,
                user_evaluation_id INTEGER,
                merchant_evaluation_id INTEGER,
                report_content TEXT,
                created_at INTEGER DEFAULT (strftime('%s', 'now')),
                updated_at INTEGER DEFAULT (strftime('%s', 'now')),
                FOREIGN KEY (merchant_id) REFERENCES merchants(id),
                FOREIGN KEY (region_id) REFERENCES regions(id),
                FOREIGN KEY (booking_session_id) REFERENCES booking_sessions(id)
            )
        `);

        // 评价表 - 统一评价系统
        this.coreDb.exec(`
            CREATE TABLE IF NOT EXISTS evaluations (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                order_id INTEGER,
                booking_session_id TEXT,
                evaluator_type TEXT CHECK(evaluator_type IN ('user', 'merchant')) NOT NULL,
                evaluator_id INTEGER NOT NULL,
                target_id INTEGER NOT NULL,
                overall_score INTEGER CHECK(overall_score >= 1 AND overall_score <= 10),
                detail_scores TEXT,
                text_comment TEXT,
                status TEXT CHECK(status IN ('pending', 'overall_completed', 'completed')) DEFAULT 'pending',
                created_at INTEGER DEFAULT (strftime('%s', 'now')),
                updated_at INTEGER DEFAULT (strftime('%s', 'now')),
                FOREIGN KEY (order_id) REFERENCES orders(id),
                FOREIGN KEY (booking_session_id) REFERENCES booking_sessions(id)
            )
        `);

        // 评价会话表 - 支持分步评价流程
        this.coreDb.exec(`
            CREATE TABLE IF NOT EXISTS evaluation_sessions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                evaluation_id INTEGER NOT NULL,
                current_step TEXT,
                temp_data TEXT,
                created_at INTEGER DEFAULT (strftime('%s', 'now')),
                updated_at INTEGER DEFAULT (strftime('%s', 'now')),
                FOREIGN KEY (evaluation_id) REFERENCES evaluations(id)
            )
        `);

        // 数据统计缓存表
        this.coreDb.exec(`
            CREATE TABLE IF NOT EXISTS order_stats (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                stat_date TEXT NOT NULL,
                stat_type TEXT NOT NULL,
                region_id INTEGER,
                price_range TEXT,
                merchant_id INTEGER,
                total_orders INTEGER DEFAULT 0,
                confirmed_orders INTEGER DEFAULT 0,
                completed_orders INTEGER DEFAULT 0,
                cancelled_orders INTEGER DEFAULT 0,
                avg_user_score REAL DEFAULT 0,
                avg_merchant_score REAL DEFAULT 0,
                total_evaluations INTEGER DEFAULT 0,
                created_at INTEGER DEFAULT (strftime('%s', 'now')),
                updated_at INTEGER DEFAULT (strftime('%s', 'now')),
                UNIQUE(stat_date, stat_type, region_id, price_range, merchant_id)
            )
        `);

        // 商家评分汇总表
        this.coreDb.exec(`
            CREATE TABLE IF NOT EXISTS merchant_ratings (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                merchant_id INTEGER NOT NULL,
                total_evaluations INTEGER DEFAULT 0,
                avg_overall_score REAL DEFAULT 0,
                avg_length_score REAL DEFAULT 0,
                avg_hardness_score REAL DEFAULT 0,
                avg_duration_score REAL DEFAULT 0,
                avg_technique_score REAL DEFAULT 0,
                overall_rank INTEGER,
                region_rank INTEGER,
                price_range_rank INTEGER,
                last_updated INTEGER DEFAULT (strftime('%s', 'now')),
                FOREIGN KEY (merchant_id) REFERENCES merchants(id),
                UNIQUE(merchant_id)
            )
        `);

        // 用户评分汇总表
        this.coreDb.exec(`
            CREATE TABLE IF NOT EXISTS user_ratings (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                total_evaluations INTEGER DEFAULT 0,
                avg_overall_score REAL DEFAULT 0,
                avg_attitude_score REAL DEFAULT 0,
                avg_punctuality_score REAL DEFAULT 0,
                avg_cooperation_score REAL DEFAULT 0,
                last_updated INTEGER DEFAULT (strftime('%s', 'now')),
                UNIQUE(user_id)
            )
        `);

        // 创建索引 - 优化查询性能
        this.coreDb.exec(`
            CREATE INDEX IF NOT EXISTS idx_merchants_user_id ON merchants (user_id);
            CREATE INDEX IF NOT EXISTS idx_merchants_region_id ON merchants (region_id);
            CREATE INDEX IF NOT EXISTS idx_merchants_status ON merchants (status);
            CREATE INDEX IF NOT EXISTS idx_booking_sessions_user_id ON booking_sessions (user_id);
            CREATE INDEX IF NOT EXISTS idx_booking_sessions_merchant_id ON booking_sessions (merchant_id);
            CREATE INDEX IF NOT EXISTS idx_orders_date ON orders (date(created_at, 'unixepoch'));
            CREATE INDEX IF NOT EXISTS idx_orders_status ON orders (status);
            CREATE INDEX IF NOT EXISTS idx_orders_merchant ON orders (merchant_id);
            CREATE INDEX IF NOT EXISTS idx_orders_region ON orders (region_id);
            CREATE INDEX IF NOT EXISTS idx_orders_price_range ON orders (price_range);
            CREATE INDEX IF NOT EXISTS idx_orders_number ON orders (order_number);
            CREATE INDEX IF NOT EXISTS idx_evaluations_order ON evaluations (order_id);
            CREATE INDEX IF NOT EXISTS idx_evaluations_type ON evaluations (evaluator_type);
            CREATE INDEX IF NOT EXISTS idx_evaluations_booking ON evaluations (booking_session_id);
            CREATE INDEX IF NOT EXISTS idx_stats_date_type ON order_stats (stat_date, stat_type);
            CREATE INDEX IF NOT EXISTS idx_merchant_ratings_score ON merchant_ratings (avg_overall_score DESC);
            CREATE INDEX IF NOT EXISTS idx_user_ratings_score ON user_ratings (avg_overall_score DESC);
        `);

        console.log('核心数据库初始化完成');
    }

    // 初始化模板数据库（消息模板、按钮配置等）
    initializeTemplateDatabase() {
        // 消息模板表
        this.templateDb.exec(`
            CREATE TABLE IF NOT EXISTS message_templates (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                content TEXT NOT NULL,
                image_url TEXT,
                buttons_config TEXT,
                created_at INTEGER DEFAULT (strftime('%s', 'now')),
                updated_at INTEGER DEFAULT (strftime('%s', 'now'))
            )
        `);

        // 触发词配置表
        this.templateDb.exec(`
            CREATE TABLE IF NOT EXISTS trigger_words (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                word TEXT NOT NULL,
                template_id INTEGER,
                match_type TEXT DEFAULT 'exact',
                chat_id TEXT,
                trigger_count INTEGER DEFAULT 0,
                active BOOLEAN DEFAULT 1,
                created_at INTEGER DEFAULT (strftime('%s', 'now')),
                FOREIGN KEY (template_id) REFERENCES message_templates (id)
            )
        `);

        // 定时任务表
        this.templateDb.exec(`
            CREATE TABLE IF NOT EXISTS scheduled_tasks (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                template_id INTEGER,
                chat_id TEXT,
                schedule_type TEXT NOT NULL,
                schedule_time TEXT NOT NULL,
                active BOOLEAN DEFAULT 1,
                last_run INTEGER,
                next_run INTEGER,
                created_at INTEGER DEFAULT (strftime('%s', 'now')),
                FOREIGN KEY (template_id) REFERENCES message_templates (id)
            )
        `);

        // 按钮配置表
        this.templateDb.exec(`
            CREATE TABLE IF NOT EXISTS button_configs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                title TEXT NOT NULL,
                merchant_id INTEGER,
                message TEXT,
                click_count INTEGER DEFAULT 0,
                created_at INTEGER DEFAULT (strftime('%s', 'now')),
                FOREIGN KEY (merchant_id) REFERENCES merchants (id)
            )
        `);

        console.log('模板数据库初始化完成');
    }

    // 初始化用户数据库（按月分区）
    initializeUserDatabase(db) {
        // 用户预约数据表
        db.exec(`
            CREATE TABLE IF NOT EXISTS user_bookings (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                booking_session_id TEXT NOT NULL,
                user_id INTEGER NOT NULL,
                user_name TEXT,
                user_username TEXT,
                merchant_id INTEGER NOT NULL,
                teacher_name TEXT,
                course_content TEXT,
                price TEXT,
                booking_time TEXT,
                status TEXT DEFAULT 'pending',
                created_at INTEGER DEFAULT (strftime('%s', 'now'))
            )
        `);

        // 用户评价数据表
        db.exec(`
            CREATE TABLE IF NOT EXISTS user_evaluations (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                booking_session_id TEXT NOT NULL,
                user_id INTEGER NOT NULL,
                merchant_id INTEGER NOT NULL,
                evaluation_data TEXT,
                rating INTEGER,
                comment TEXT,
                created_at INTEGER DEFAULT (strftime('%s', 'now'))
            )
        `);

        // 用户报告数据表
        db.exec(`
            CREATE TABLE IF NOT EXISTS user_reports (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                booking_session_id TEXT NOT NULL,
                user_id INTEGER NOT NULL,
                merchant_id INTEGER NOT NULL,
                report_content TEXT,
                chart_data TEXT,
                created_at INTEGER DEFAULT (strftime('%s', 'now'))
            )
        `);

        // 商家接单数据表
        db.exec(`
            CREATE TABLE IF NOT EXISTS merchant_orders (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                booking_session_id TEXT NOT NULL,
                merchant_id INTEGER NOT NULL,
                user_id INTEGER NOT NULL,
                course_type TEXT,
                order_status TEXT DEFAULT 'pending',
                completed_at INTEGER,
                created_at INTEGER DEFAULT (strftime('%s', 'now'))
            )
        `);

        // 商家评价数据表
        db.exec(`
            CREATE TABLE IF NOT EXISTS merchant_evaluations (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                booking_session_id TEXT NOT NULL,
                merchant_id INTEGER NOT NULL,
                user_id INTEGER NOT NULL,
                evaluation_data TEXT,
                rating INTEGER,
                comment TEXT,
                created_at INTEGER DEFAULT (strftime('%s', 'now'))
            )
        `);

        // 用户交互记录表
        db.exec(`
            CREATE TABLE IF NOT EXISTS user_interactions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                username TEXT,
                first_name TEXT,
                last_name TEXT,
                merchant_id INTEGER,
                template_id INTEGER,
                action_type TEXT,
                chat_id TEXT,
                interaction_data TEXT,
                created_at INTEGER DEFAULT (strftime('%s', 'now'))
            )
        `);

        // 创建索引
        db.exec(`
            CREATE INDEX IF NOT EXISTS idx_user_bookings_user_id ON user_bookings (user_id);
            CREATE INDEX IF NOT EXISTS idx_user_bookings_merchant_id ON user_bookings (merchant_id);
            CREATE INDEX IF NOT EXISTS idx_user_bookings_booking_time ON user_bookings (booking_time);
            CREATE INDEX IF NOT EXISTS idx_user_evaluations_user_id ON user_evaluations (user_id);
            CREATE INDEX IF NOT EXISTS idx_user_evaluations_merchant_id ON user_evaluations (merchant_id);
            CREATE INDEX IF NOT EXISTS idx_merchant_orders_merchant_id ON merchant_orders (merchant_id);
            CREATE INDEX IF NOT EXISTS idx_merchant_orders_user_id ON merchant_orders (user_id);
            CREATE INDEX IF NOT EXISTS idx_user_interactions_user_id ON user_interactions (user_id);
            CREATE INDEX IF NOT EXISTS idx_user_interactions_action_type ON user_interactions (action_type);
        `);

        console.log('用户数据库初始化完成');
    }

    // 获取指定月份的用户数据库
    getUserDatabaseForMonth(year, month) {
        const monthStr = String(month).padStart(2, '0');
        const dbName = `users_${year}_${monthStr}.db`;
        const db = new Database(path.join(this.dbPath, dbName));
        
        // 确保表结构存在
        this.initializeUserDatabase(db);
        
        return db;
    }

    // 获取所有用户数据库文件
    getAllUserDatabases() {
        const fs = require('fs');
        const files = fs.readdirSync(this.dbPath);
        const userDbFiles = files.filter(file => file.match(/^users_\d{4}_\d{2}\.db$/));
        
        return userDbFiles.map(file => {
            const match = file.match(/^users_(\d{4})_(\d{2})\.db$/);
            return {
                file: file,
                year: parseInt(match[1]),
                month: parseInt(match[2]),
                path: path.join(this.dbPath, file),
                db: new Database(path.join(this.dbPath, file))
            };
        });
    }

    // 数据迁移：将旧数据迁移到新结构
    migrateOldData(oldDbPath) {
        try {
            const oldDb = new Database(oldDbPath);
            
            // 迁移地区数据
            this.migrateRegions(oldDb);
            
            // 迁移绑定码数据
            this.migrateBindCodes(oldDb);
            
            // 迁移商家数据
            this.migrateMerchants(oldDb);
            
            // 迁移模板数据
            this.migrateTemplates(oldDb);
            
            // 迁移用户数据
            this.migrateUserData(oldDb);
            
            oldDb.close();
            console.log('数据迁移完成');
            
        } catch (error) {
            console.error('数据迁移失败:', error);
            throw error;
        }
    }

    // 迁移地区数据
    migrateRegions(oldDb) {
        try {
            const regions = oldDb.prepare('SELECT * FROM regions').all();
            const insertStmt = this.coreDb.prepare(`
                INSERT OR REPLACE INTO regions (id, name, sort_order, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?)
            `);
            
            regions.forEach(region => {
                insertStmt.run(
                    region.id,
                    region.name,
                    region.sort_order || 0,
                    region.created_at || Math.floor(Date.now() / 1000),
                    region.updated_at || Math.floor(Date.now() / 1000)
                );
            });
            
            console.log(`迁移了 ${regions.length} 个地区`);
        } catch (error) {
            console.error('迁移地区数据失败:', error);
        }
    }

    // 迁移绑定码数据
    migrateBindCodes(oldDb) {
        try {
            const bindCodes = oldDb.prepare('SELECT * FROM bind_codes').all();
            const insertStmt = this.coreDb.prepare(`
                INSERT OR REPLACE INTO bind_codes 
                (id, code, description, used, used_by_user_id, used_by_username, created_at, used_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            `);
            
            bindCodes.forEach(bindCode => {
                insertStmt.run(
                    bindCode.id,
                    bindCode.code,
                    bindCode.description,
                    bindCode.used ? 1 : 0,
                    bindCode.used_by_user_id,
                    bindCode.used_by_username,
                    bindCode.created_at || Math.floor(Date.now() / 1000),
                    bindCode.used_at
                );
            });
            
            console.log(`迁移了 ${bindCodes.length} 个绑定码`);
        } catch (error) {
            console.error('迁移绑定码数据失败:', error);
        }
    }

    // 迁移商家数据
    migrateMerchants(oldDb) {
        try {
            const merchants = oldDb.prepare('SELECT * FROM merchants').all();
            const insertStmt = this.coreDb.prepare(`
                INSERT OR REPLACE INTO merchants 
                (id, user_id, username, first_name, last_name, region_id, teacher_name, contact, 
                 bind_code, bind_step, status, price1, price2, p_price, pp_price, 
                 advantages, disadvantages, skill_wash, skill_blow, skill_do, skill_kiss, 
                 created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `);
            
            merchants.forEach(merchant => {
                insertStmt.run(
                    merchant.id,
                    merchant.user_id,
                    merchant.username,
                    merchant.first_name,
                    merchant.last_name,
                    merchant.region_id,
                    merchant.teacher_name,
                    merchant.contact,
                    merchant.bind_code,
                    merchant.bind_step || 0,
                    merchant.status || 'inactive',
                    merchant.price1,
                    merchant.price2,
                    merchant.p_price,
                    merchant.pp_price,
                    merchant.advantages,
                    merchant.disadvantages,
                    merchant.skill_wash,
                    merchant.skill_blow,
                    merchant.skill_do,
                    merchant.skill_kiss,
                    merchant.created_at || Math.floor(Date.now() / 1000),
                    merchant.updated_at || Math.floor(Date.now() / 1000)
                );
            });
            
            console.log(`迁移了 ${merchants.length} 个商家`);
        } catch (error) {
            console.error('迁移商家数据失败:', error);
        }
    }

    // 迁移模板数据
    migrateTemplates(oldDb) {
        try {
            // 迁移消息模板
            const templates = oldDb.prepare('SELECT * FROM templates').all();
            const insertTemplateStmt = this.templateDb.prepare(`
                INSERT OR REPLACE INTO message_templates 
                (id, name, content, image_url, buttons_config, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?)
            `);
            
            templates.forEach(template => {
                insertTemplateStmt.run(
                    template.id,
                    template.name,
                    template.content,
                    template.image_url,
                    template.buttons_config,
                    template.created_at || Math.floor(Date.now() / 1000),
                    template.updated_at || Math.floor(Date.now() / 1000)
                );
            });
            
            console.log(`迁移了 ${templates.length} 个消息模板`);
        } catch (error) {
            console.error('迁移模板数据失败:', error);
        }
    }

    // 迁移用户数据
    migrateUserData(oldDb) {
        try {
            // 迁移订单数据到当前月份数据库
            const orders = oldDb.prepare('SELECT * FROM orders').all();
            const insertOrderStmt = this.currentUserDb.prepare(`
                INSERT OR REPLACE INTO user_bookings 
                (booking_session_id, user_id, user_name, user_username, merchant_id, 
                 teacher_name, teacher_contact, course_content, price, booking_time, 
                 status, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `);
            
            orders.forEach(order => {
                insertOrderStmt.run(
                    order.booking_session_id,
                    order.user_id,
                    order.user_name,
                    order.user_username,
                    order.merchant_id,
                    order.teacher_name,
                    order.teacher_contact,
                    order.course_content,
                    order.price,
                    order.booking_time,
                    order.status,
                    order.created_at || Math.floor(Date.now() / 1000),
                    order.updated_at || Math.floor(Date.now() / 1000)
                );
            });
            
            console.log(`迁移了 ${orders.length} 个订单`);
        } catch (error) {
            console.error('迁移用户数据失败:', error);
        }
    }

    // 关闭所有数据库连接
    closeAll() {
        try {
            this.coreDb.close();
            this.templateDb.close();
            this.currentUserDb.close();
            console.log('所有数据库连接已关闭');
        } catch (error) {
            console.error('关闭数据库连接失败:', error);
        }
    }

    // 获取数据库实例
    getCoreDatabase() {
        return this.coreDb;
    }

    getTemplateDatabase() {
        return this.templateDb;
    }

    getCurrentUserDatabase() {
        return this.currentUserDb;
    }
}

module.exports = DatabaseSchema; 