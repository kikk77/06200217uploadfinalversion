#!/usr/bin/env node

// Staging环境数据初始化脚本
const path = require('path');
const fs = require('fs');

console.log('🚀 初始化Staging环境数据...');

// 初始化数据库表结构
function initializeDatabase() {
    try {
        // Railway Volume路径配置
        let dbPath;
        if (process.env.RAILWAY_VOLUME_MOUNT_PATH) {
            // Railway环境，使用Volume路径
            dbPath = `${process.env.RAILWAY_VOLUME_MOUNT_PATH}/marketing_bot.db`;
            console.log('🚂 Railway环境检测到，使用Volume存储:', dbPath);
        } else if (process.env.NODE_ENV === 'production') {
            // 其他生产环境
            dbPath = '/app/data/marketing_bot.db';
            console.log('🏭 生产环境，使用标准路径:', dbPath);
        } else {
            // 本地开发环境
            dbPath = './data/marketing_bot.db';
            console.log('💻 本地开发环境:', dbPath);
        }
        
        // 确保数据目录存在
        const dataDir = path.dirname(dbPath);
        if (!fs.existsSync(dataDir)) {
            fs.mkdirSync(dataDir, { recursive: true });
        }
        
        const Database = require('better-sqlite3');
        const db = new Database(dbPath);
        
        console.log('📋 创建基础表结构...');
        
        // 创建regions表
        db.exec(`
            CREATE TABLE IF NOT EXISTS regions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                sort_order INTEGER DEFAULT 0,
                active INTEGER DEFAULT 1
            )
        `);
        
        // 创建merchants表
        db.exec(`
            CREATE TABLE IF NOT EXISTS merchants (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER UNIQUE,
                username TEXT,
                bind_code TEXT,
                bind_step INTEGER DEFAULT 0,
                status TEXT DEFAULT 'pending',
                teacher_name TEXT,
                contact TEXT,
                region_id INTEGER,
                price1 REAL,
                price2 REAL,
                created_at INTEGER DEFAULT (strftime('%s', 'now')),
                updated_at INTEGER DEFAULT (strftime('%s', 'now')),
                FOREIGN KEY (region_id) REFERENCES regions(id)
            )
        `);
        
        // 创建orders表
        db.exec(`
            CREATE TABLE IF NOT EXISTS orders (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                order_number TEXT,
                user_id INTEGER,
                user_name TEXT,
                user_username TEXT,
                merchant_id INTEGER,
                teacher_name TEXT,
                region_id INTEGER,
                course_type TEXT,
                course_content TEXT,
                price_range TEXT,
                actual_price REAL,
                status TEXT DEFAULT 'pending',
                booking_session_id TEXT,
                booking_time TEXT,
                user_evaluation TEXT,
                merchant_evaluation TEXT,
                created_at INTEGER DEFAULT (strftime('%s', 'now')),
                updated_at INTEGER DEFAULT (strftime('%s', 'now')),
                FOREIGN KEY (merchant_id) REFERENCES merchants(id),
                FOREIGN KEY (region_id) REFERENCES regions(id)
            )
        `);
        
        // 插入示例数据
        console.log('📝 插入示例数据...');
        
        // 插入地区数据
        const regions = [
            { name: '黄埔区', sort_order: 1 },
            { name: '天河区', sort_order: 2 },
            { name: '越秀区', sort_order: 3 },
            { name: '海珠区', sort_order: 4 },
            { name: '荔湾区', sort_order: 5 }
        ];
        
        const insertRegion = db.prepare('INSERT OR IGNORE INTO regions (name, sort_order) VALUES (?, ?)');
        regions.forEach(region => {
            insertRegion.run(region.name, region.sort_order);
        });
        
        // 插入示例商家
        const merchants = [
            { username: 'setrnkkkk', teacher_name: 'setrnkkkk', status: 'active', region_id: 1, price1: 200, price2: 300 },
            { username: 'test_merchant', teacher_name: '测试商家', status: 'active', region_id: 2, price1: 150, price2: 250 }
        ];
        
        const insertMerchant = db.prepare('INSERT OR IGNORE INTO merchants (username, teacher_name, status, region_id, price1, price2) VALUES (?, ?, ?, ?, ?, ?)');
        merchants.forEach(merchant => {
            insertMerchant.run(merchant.username, merchant.teacher_name, merchant.status, merchant.region_id, merchant.price1, merchant.price2);
        });
        
        // 插入示例订单
        const orders = [
            {
                order_number: 'ORD20250625085856779',
                user_name: '上海小鸡客服（双向点我头像）',
                user_username: 'test_user',
                merchant_id: 1,
                teacher_name: 'setrnkkkk',
                course_type: 'pp',
                course_content: 'pp',
                actual_price: 200,
                status: 'completed',
                created_at: Math.floor(Date.now() / 1000) - 86400 // 1天前
            }
        ];
        
        const insertOrder = db.prepare(`
            INSERT OR IGNORE INTO orders 
            (order_number, user_name, user_username, merchant_id, teacher_name, course_type, course_content, actual_price, status, created_at) 
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);
        
        orders.forEach(order => {
            insertOrder.run(
                order.order_number, order.user_name, order.user_username, 
                order.merchant_id, order.teacher_name, order.course_type, 
                order.course_content, order.actual_price, order.status, order.created_at
            );
        });
        
        db.close();
        
        console.log('✅ Staging环境数据初始化完成');
        console.log(`📍 数据库位置: ${dbPath}`);
        
        return true;
    } catch (error) {
        console.error('❌ 数据初始化失败:', error);
        return false;
    }
}

// 如果直接运行此脚本
if (require.main === module) {
    initializeDatabase();
}

module.exports = { initializeDatabase }; 