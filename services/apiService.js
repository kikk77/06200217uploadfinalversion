const orderService = require('./orderService');
const evaluationService = require('./evaluationService');
const dbOperations = require('../models/dbOperations');
const { db } = require('../config/database');
const DataExportService = require('./dataExportService');
const MerchantReportService = require('./merchantReportService');
// statsService将在需要时延迟加载

class ApiService {
    constructor() {
        this.routes = new Map();
        this.dataExportService = new DataExportService();
        this.merchantReportService = new MerchantReportService();
        this.setupRoutes();
        
        // 请求缓存
        this.requestCache = new Map();
        this.cacheTimeout = 2 * 60 * 1000; // 2分钟缓存
        
        // 定期清理过期缓存
        setInterval(() => {
            const now = Date.now();
            for (const [key, data] of this.requestCache.entries()) {
                if (now - data.timestamp > this.cacheTimeout) {
                    this.requestCache.delete(key);
                }
            }
        }, 60 * 1000); // 每分钟清理一次
        
        // 延迟加载服务
        this.dataImportService = null;
    }

    setupRoutes() {
        // 统计相关接口
        this.routes.set('GET /api/stats/optimized', this.getOptimizedStats.bind(this));
        this.routes.set('GET /api/stats/dashboard', this.getDashboardStats.bind(this));
        this.routes.set('GET /api/stats/cache-info', this.getCacheInfo.bind(this));
        this.routes.set('GET /api/stats', this.getBasicStats.bind(this));
        this.routes.set('GET /api/merchant-bookings', this.getMerchantBookings.bind(this));
        this.routes.set('GET /api/recent-bookings', this.getRecentBookings.bind(this));
        this.routes.set('GET /api/message-stats', this.getMessageStats.bind(this));
        this.routes.set('GET /api/button-stats', this.getButtonStats.bind(this));
        this.routes.set('GET /api/evaluation-stats', this.getEvaluationStats.bind(this));
        this.routes.set('GET /api/evaluations', this.getEvaluations.bind(this));
        this.routes.set('GET /api/evaluations/:id', this.getEvaluationDetails.bind(this));

        // 图表数据接口
        this.routes.set('GET /api/charts/orders-trend', this.getOrdersTrendChart.bind(this));
        this.routes.set('GET /api/charts/region-distribution', this.getRegionDistributionChart.bind(this));
        this.routes.set('GET /api/charts/price-distribution', this.getPriceDistributionChart.bind(this));
        this.routes.set('GET /api/charts/status-distribution', this.getStatusDistributionChart.bind(this));

        // 订单相关接口
        this.routes.set('GET /api/orders', this.getOrders.bind(this));
        this.routes.set('GET /api/orders/:id', this.getOrderById.bind(this));

        // 基础数据接口
        this.routes.set('GET /api/regions', this.getRegions.bind(this));
        this.routes.set('GET /api/merchants', this.getMerchants.bind(this));
        this.routes.set('POST /api/merchants', this.createMerchant.bind(this));
        this.routes.set('PUT /api/merchants/:id/status', this.toggleMerchantStatus.bind(this));
        this.routes.set('POST /api/merchants/check-follow-status', this.checkMerchantsFollowStatus.bind(this));
        this.routes.set('POST /api/merchants/test-follow-status', this.testSingleMerchantFollowStatus.bind(this));

        // 排名接口
        this.routes.set('GET /api/rankings/merchants', this.getMerchantRankings.bind(this));
        this.routes.set('GET /api/rankings/users', this.getUserRankings.bind(this));

        // 简单计数接口
        this.routes.set('GET /api/simple-count/:table', this.getSimpleCount.bind(this));

        // 数据导出接口
        this.routes.set('POST /api/export/all-data', this.exportAllData.bind(this));
        this.routes.set('GET /api/export/history', this.getExportHistory.bind(this));
        this.routes.set('GET /api/export/download/:filename', this.downloadExport.bind(this));
        this.routes.set('DELETE /api/export/cleanup', this.cleanupOldExports.bind(this));

        // 数据刷新接口
        this.routes.set('POST /api/refresh-data', this.refreshAllData.bind(this));

        // 绑定码接口
        this.routes.set('GET /api/bind-codes', this.getBindCodes.bind(this));
        this.routes.set('POST /api/bind-codes', this.createBindCode.bind(this));
        this.routes.set('DELETE /api/bind-codes/:id', this.deleteBindCode.bind(this));
        this.routes.set('DELETE /api/bind-codes/:id/force', this.forceDeleteBindCode.bind(this));

        // 商家报告接口
        this.routes.set('GET /api/merchant-reports/templates', this.getMerchantReportTemplates.bind(this));
        this.routes.set('POST /api/merchant-reports/generate', this.generateMerchantReport.bind(this));
        this.routes.set('POST /api/merchant-reports/send', this.sendMerchantReport.bind(this));
        this.routes.set('GET /api/merchant-reports/ranking/:year/:month', this.getMerchantMonthlyRanking.bind(this));
        this.routes.set('POST /api/merchant-reports/refresh-ranking', this.refreshMerchantRanking.bind(this));
        
        // 用户排名相关路由
        this.routes.set('GET /api/user-rankings/:year/:month', this.getUserMonthlyRanking.bind(this));
        this.routes.set('POST /api/user-rankings/refresh', this.refreshUserRanking.bind(this));

        
        console.log('API路由设置完成，共', this.routes.size, '个路由');
    }

    // 处理HTTP请求
    async handleRequest(method, path, query = {}, body = {}) {
        try {
            const routeKey = `${method} ${path}`;
            const handler = this.routes.get(routeKey);
            
            if (!handler) {
                // 尝试匹配带参数的路由
                for (const [route, routeHandler] of this.routes.entries()) {
                    const [routeMethod, routePath] = route.split(' ');
                    if (routeMethod === method && this.matchRoute(routePath, path)) {
                        const params = this.extractParams(routePath, path);
                        return await routeHandler({ query, body, params });
                    }
                }
                
                return {
                    success: false,
                    status: 404,
                    message: '接口不存在'
                };
            }

            const result = await handler({ query, body });
            return {
                success: true,
                status: 200,
                ...result
            };

        } catch (error) {
            console.error('API请求处理失败:', error);
            return {
                success: false,
                status: 500,
                message: error.message || '服务器内部错误'
            };
        }
    }

    // 路由匹配
    matchRoute(routePath, actualPath) {
        const routeParts = routePath.split('/');
        const actualParts = actualPath.split('/');
        
        if (routeParts.length !== actualParts.length) return false;
        
        return routeParts.every((part, index) => {
            return part.startsWith(':') || part === actualParts[index];
        });
    }

    // 提取路由参数
    extractParams(routePath, actualPath) {
        const routeParts = routePath.split('/');
        const actualParts = actualPath.split('/');
        const params = {};
        
        routeParts.forEach((part, index) => {
            if (part.startsWith(':')) {
                const paramName = part.substring(1);
                params[paramName] = actualParts[index];
            }
        });
        
        return params;
    }

    // 获取优化的统计数据
    async getOptimizedStats({ query }) {
        try {
            const filters = this.parseFilters(query);
            const whereConditions = this.buildWhereConditions(filters);
            const whereClause = whereConditions.conditions.join(' AND ');
            const params = whereConditions.params;

            // 1. 基础订单统计 - 使用与订单列表一致的状态判断逻辑
            const orderStats = db.prepare(`
                SELECT 
                    COUNT(*) as totalOrders,
                    SUM(CASE 
                        WHEN bs.user_course_status = 'confirmed' OR o.status = 'confirmed' 
                        THEN 1 ELSE 0 
                    END) as bookedOrders,
                    SUM(CASE 
                        WHEN bs.user_course_status != 'completed' 
                        OR bs.user_course_status IS NULL
                        THEN 1 ELSE 0 
                    END) as incompleteOrders,
                    SUM(CASE 
                        WHEN bs.user_course_status = 'completed' 
                        THEN 1 ELSE 0 
                    END) as completedOrders
                FROM orders o
                LEFT JOIN merchants m ON o.merchant_id = m.id
                LEFT JOIN regions r ON m.region_id = r.id
                LEFT JOIN booking_sessions bs ON o.booking_session_id = bs.id
                WHERE ${whereClause}
            `).get(...params);

            // 2. 计算平均订单价格 - 根据课程内容和商家价格设置
            const priceStats = db.prepare(`
                SELECT 
                    AVG(
                        CASE 
                            WHEN o.price_range IS NOT NULL AND o.price_range != '未设置' AND CAST(o.price_range AS REAL) > 0 
                            THEN CAST(o.price_range AS REAL)
                            WHEN o.course_content = 'p' AND m.price1 IS NOT NULL 
                            THEN CAST(m.price1 AS REAL)
                            WHEN o.course_content = 'pp' AND m.price2 IS NOT NULL 
                            THEN CAST(m.price2 AS REAL)
                            ELSE NULL
                        END
                    ) as avgPrice
                FROM orders o
                LEFT JOIN merchants m ON o.merchant_id = m.id
                LEFT JOIN regions r ON m.region_id = r.id
                LEFT JOIN booking_sessions bs ON o.booking_session_id = bs.id
                WHERE ${whereClause}
            `).get(...params);

            // 3. 计算平均用户评分 - 基于evaluations表
            const userRatingStats = db.prepare(`
                SELECT AVG(e.overall_score) as avgUserRating
                FROM evaluations e
                INNER JOIN orders o ON e.booking_session_id = o.booking_session_id
                LEFT JOIN merchants m ON o.merchant_id = m.id
                LEFT JOIN regions r ON m.region_id = r.id
                LEFT JOIN booking_sessions bs ON o.booking_session_id = bs.id
                WHERE e.evaluator_type = 'user' 
                AND e.status = 'completed' 
                AND e.overall_score IS NOT NULL
                AND ${whereClause}
            `).get(...params);

            // 4. 计算平均出击素质 - 基于evaluations表
            const merchantRatingStats = db.prepare(`
                SELECT AVG(e.overall_score) as avgMerchantRating
                FROM evaluations e
                INNER JOIN orders o ON e.booking_session_id = o.booking_session_id
                LEFT JOIN merchants m ON o.merchant_id = m.id
                LEFT JOIN regions r ON m.region_id = r.id
                LEFT JOIN booking_sessions bs ON o.booking_session_id = bs.id
                WHERE e.evaluator_type = 'merchant' 
                AND e.status = 'completed' 
                AND e.overall_score IS NOT NULL
                AND ${whereClause}
            `).get(...params);

            // 5. 计算完成率
            const completionRate = orderStats.totalOrders > 0 ? 
                (orderStats.completedOrders / orderStats.totalOrders) * 100 : 0;

            const stats = {
                totalOrders: orderStats.totalOrders || 0,
                bookedOrders: orderStats.bookedOrders || 0,  // 已预约订单 (confirmed状态)
                incompleteOrders: orderStats.incompleteOrders || 0,  // 待处理订单 (包括预约完成但课程未完成的订单)
                completedOrders: orderStats.completedOrders || 0,  // 已完成订单
                avgPrice: priceStats.avgPrice ? Math.round(priceStats.avgPrice) : 0,  // 平均订单价格
                avgUserRating: userRatingStats.avgUserRating ? Math.round(userRatingStats.avgUserRating * 10) / 10 : 0,  // 平均用户评分
                avgMerchantRating: merchantRatingStats.avgMerchantRating ? Math.round(merchantRatingStats.avgMerchantRating * 10) / 10 : 0,  // 平均出击素质
                completionRate: Math.round(completionRate * 10) / 10  // 完成率
            };
            
            return {
                success: true,
                data: stats,
                fromCache: false
            };
        } catch (error) {
            console.error('获取统计数据失败:', error);
            throw new Error('获取统计数据失败: ' + error.message);
        }
    }

    // 获取仪表板统计
    async getDashboardStats({ query }) {
        try {
            const filters = this.parseFilters(query);
            
            // 延迟加载statsService
            let hotQueries = [];
            let cacheStats = {};
            try {
                const statsService = require('./statsService');
                hotQueries = await statsService.getHotQueries();
                cacheStats = statsService.getCacheStats();
            } catch (error) {
                console.warn('统计服务暂不可用:', error.message);
            }
            
            // 计算关键指标
            const stats = await this.calculateDashboardMetrics(filters);
            
            return {
                data: {
                    metrics: stats,
                    hotQueries,
                    cacheStats
                }
            };
        } catch (error) {
            throw new Error('获取仪表板数据失败: ' + error.message);
        }
    }

    // 计算仪表板指标
    async calculateDashboardMetrics(filters) {
        try {
            const whereConditions = this.buildWhereConditions(filters);
            const whereClause = whereConditions.conditions.join(' AND ');
            const params = whereConditions.params;

            const metrics = db.prepare(`
                SELECT 
                    COUNT(*) as totalOrders,
                    SUM(CASE 
                        WHEN bs.user_course_status = 'confirmed' OR o.status = 'confirmed' 
                        THEN 1 ELSE 0 
                    END) as confirmedOrders,
                    SUM(CASE 
                        WHEN bs.user_course_status = 'completed' 
                        THEN 1 ELSE 0 
                    END) as completedOrders,
                    AVG(CAST(o.price_range AS REAL)) as avgPrice,
                    CAST(SUM(CASE 
                        WHEN bs.user_course_status = 'completed' 
                        THEN 1 ELSE 0 
                    END) AS FLOAT) / NULLIF(COUNT(*), 0) as completionRate
                FROM orders o
                LEFT JOIN booking_sessions bs ON o.booking_session_id = bs.id
                WHERE ${whereClause}
            `).get(...params);

            // 获取平均评分
            const avgRatingResult = db.prepare(`
                SELECT 
                    AVG(CAST(json_extract(o.user_evaluation, '$.overall_score') AS REAL)) as avgUserRating,
                    AVG(CAST(json_extract(o.merchant_evaluation, '$.overall_score') AS REAL)) as avgMerchantRating
                FROM orders o
                LEFT JOIN booking_sessions bs ON o.booking_session_id = bs.id
                WHERE ${whereClause} AND bs.user_course_status = 'completed'
            `).get(...params);

            const avgRating = (avgRatingResult.avgUserRating + avgRatingResult.avgMerchantRating) / 2 || 0;

            return {
                ...metrics,
                avgPrice: Math.round(metrics.avgPrice || 0),
                avgRating: Math.round(avgRating * 10) / 10,
                completionRate: Math.round((metrics.completionRate || 0) * 100) / 100
            };
        } catch (error) {
            throw new Error('计算仪表板指标失败: ' + error.message);
        }
    }

    // 获取订单趋势图表数据
    async getOrdersTrendChart({ query }) {
        try {
            const filters = this.parseFilters(query);
            const period = query.period || 'daily';
            
            let dateFormat, groupBy;
            switch (period) {
                case 'hourly':
                    dateFormat = '%Y-%m-%d %H:00:00';
                    groupBy = "strftime('%Y-%m-%d %H', datetime(o.created_at))";
                    break;
                case 'weekly':
                    dateFormat = '%Y-W%W';
                    groupBy = "strftime('%Y-W%W', datetime(o.created_at))";
                    break;
                case 'monthly':
                    dateFormat = '%Y-%m';
                    groupBy = "strftime('%Y-%m', datetime(o.created_at))";
                    break;
                default: // daily
                    dateFormat = '%Y-%m-%d';
                    groupBy = "date(datetime(o.created_at))";
            }

            const whereConditions = this.buildWhereConditions(filters);
            const whereClause = whereConditions.conditions.join(' AND ');

            const trendData = db.prepare(`
                SELECT 
                    ${groupBy} as period,
                    COUNT(*) as orderCount,
                    SUM(CASE 
                        WHEN bs.user_course_status = 'completed' 
                        THEN 1 ELSE 0 
                    END) as completedCount
                FROM orders o
                LEFT JOIN booking_sessions bs ON o.booking_session_id = bs.id
                WHERE ${whereClause}
                GROUP BY ${groupBy}
                ORDER BY period DESC
                LIMIT 30
            `).all(...whereConditions.params);

            return {
                data: {
                    labels: trendData.map(d => d.period).reverse(),
                    values: trendData.map(d => d.orderCount).reverse(),
                    completedValues: trendData.map(d => d.completedCount).reverse()
                }
            };
        } catch (error) {
            console.error('获取订单趋势数据失败:', error);
            throw new Error('获取订单趋势数据失败: ' + error.message);
        }
    }

    // 获取地区分布图表数据
    async getRegionDistributionChart({ query }) {
        try {
            const filters = this.parseFilters(query);
            const whereConditions = this.buildWhereConditions(filters);
            const whereClause = whereConditions.conditions.join(' AND ');

            const regionData = db.prepare(`
                SELECT 
                    COALESCE(r.name, '未知地区') as regionName,
                    COUNT(o.id) as orderCount
                FROM orders o
                LEFT JOIN merchants m ON o.merchant_id = m.id
                LEFT JOIN regions r ON m.region_id = r.id
                WHERE ${whereClause}
                GROUP BY r.name
                ORDER BY orderCount DESC
                LIMIT 10
            `).all(...whereConditions.params);

            return {
                data: {
                    labels: regionData.map(d => d.regionName || '未知地区'),
                    values: regionData.map(d => d.orderCount)
                }
            };
        } catch (error) {
            console.error('获取地区分布数据失败:', error);
            throw new Error('获取地区分布数据失败: ' + error.message);
        }
    }

    // 获取价格分布图表数据
    async getPriceDistributionChart({ query }) {
        try {
            const filters = this.parseFilters(query);
            const whereConditions = this.buildWhereConditions(filters);
            const whereClause = whereConditions.conditions.join(' AND ');

            const priceData = db.prepare(`
                SELECT 
                    CASE 
                        WHEN CAST(o.price_range AS REAL) < 500 THEN '0-500'
                        WHEN CAST(o.price_range AS REAL) < 700 THEN '500-700'
                        WHEN CAST(o.price_range AS REAL) < 900 THEN '700-900'
                        WHEN CAST(o.price_range AS REAL) < 1100 THEN '900-1100'
                        ELSE '1100+'
                    END as price_range,
                    COUNT(*) as orderCount
                FROM orders o
                WHERE ${whereClause}
                GROUP BY price_range
                ORDER BY 
                    CASE price_range
                        WHEN '0-500' THEN 1
                        WHEN '500-700' THEN 2
                        WHEN '700-900' THEN 3
                        WHEN '900-1100' THEN 4
                        WHEN '1100+' THEN 5
                    END
            `).all(...whereConditions.params);

            return {
                data: {
                    labels: priceData.map(d => d.price_range),
                    values: priceData.map(d => d.orderCount)
                }
            };
        } catch (error) {
            console.error('获取价格分布数据失败:', error);
            throw new Error('获取价格分布数据失败: ' + error.message);
        }
    }

    // 获取状态分布图表数据
    async getStatusDistributionChart({ query }) {
        try {
            const filters = this.parseFilters(query);
            const whereConditions = this.buildWhereConditions(filters);
            const whereClause = whereConditions.conditions.join(' AND ');

            const statusData = db.prepare(`
                SELECT 
                    CASE 
                        WHEN bs.user_course_status = 'completed' THEN 'completed'
                        WHEN bs.user_course_status = 'incomplete' THEN 'incomplete'
                        WHEN bs.user_course_status = 'confirmed' OR o.status = 'confirmed' THEN 'confirmed'
                        WHEN o.status = 'attempting' THEN 'attempting'
                        WHEN o.status = 'failed' THEN 'failed'
                        WHEN o.status = 'cancelled' THEN 'cancelled'
                        ELSE 'pending'
                    END as status,
                    COUNT(*) as orderCount
                FROM orders o
                LEFT JOIN booking_sessions bs ON o.booking_session_id = bs.id
                WHERE ${whereClause}
                GROUP BY CASE 
                    WHEN bs.user_course_status = 'completed' THEN 'completed'
                    WHEN bs.user_course_status = 'incomplete' THEN 'incomplete'
                    WHEN bs.user_course_status = 'confirmed' OR o.status = 'confirmed' THEN 'confirmed'
                    WHEN o.status = 'attempting' THEN 'attempting'
                    WHEN o.status = 'failed' THEN 'failed'
                    WHEN o.status = 'cancelled' THEN 'cancelled'
                    ELSE 'pending'
                END
                ORDER BY orderCount DESC
            `).all(...whereConditions.params);

            const statusLabels = {
                'attempting': '尝试预约',
                'pending': '待确认',
                'confirmed': '已确认',
                'completed': '已完成',
                'incomplete': '未完成',
                'failed': '预约失败',
                'cancelled': '已取消'
            };

            return {
                data: {
                    labels: statusData.map(d => statusLabels[d.status] || d.status),
                    values: statusData.map(d => d.orderCount)
                }
            };
        } catch (error) {
            throw new Error('获取状态分布数据失败: ' + error.message);
        }
    }

    // 获取订单列表（支持分页和虚拟滚动）
    async getOrders({ query }) {
        try {
            const page = parseInt(query.page) || 1;
            const pageSize = parseInt(query.pageSize) || 50;
            const offset = (page - 1) * pageSize;
            const filters = this.parseFilters(query);
            
            const whereConditions = this.buildWhereConditions(filters);
            const whereClause = whereConditions.conditions.join(' AND ');
            const params = whereConditions.params;

            // 获取真实订单数据，关联商家和地区信息，包含评价状态
            const rawOrders = db.prepare(`
                SELECT 
                    o.*,
                    m.id as merchant_db_id,
                    m.teacher_name as merchant_name,
                    m.username as merchant_username,
                    m.contact as teacher_contact,
                    m.price1,
                    m.price2,
                    r.name as region_name,
                    bs.user_course_status,
                    bs.merchant_course_status,
                    bs.updated_at as completion_time,
                    -- 计算真实状态
                    CASE 
                        WHEN bs.user_course_status = 'completed' THEN 'completed'
                        WHEN bs.user_course_status = 'confirmed' OR o.status = 'confirmed' THEN 'confirmed'
                        WHEN o.status = 'cancelled' THEN 'cancelled'
                        ELSE 'pending'
                    END as real_status
                FROM orders o
                LEFT JOIN merchants m ON o.merchant_id = m.id
                LEFT JOIN regions r ON o.region_id = r.id
                LEFT JOIN booking_sessions bs ON o.booking_session_id = bs.id
                WHERE ${whereClause}
                ORDER BY o.created_at DESC
                LIMIT ? OFFSET ?
            `).all(...params, pageSize, offset);

            // 处理订单数据，计算正确价格
            const orders = rawOrders.map(order => {
                // 计算实际价格
                let actualPrice = order.actual_price;
                if (!actualPrice || actualPrice === 0) {
                    // 根据课程类型匹配商家价格
                    if (order.course_type === 'p' && order.price1) {
                        actualPrice = order.price1;
                    } else if (order.course_type === 'pp' && order.price2) {
                        actualPrice = order.price2;
                    } else if (order.course_type === 'other') {
                        actualPrice = '其他时长';
                    } else {
                        actualPrice = '未设置';
                    }
                }

                return {
                    id: order.id,
                    order_number: order.order_number || order.id,
                    user_name: order.user_name || '未知用户',
                    user_username: order.user_username,
                    merchant_id: order.merchant_id,
                    merchant_name: order.merchant_name || '未知商家',
                    teacher_contact: order.teacher_contact,
                    region_name: order.region_name || '未知地区',
                    course_type: order.course_type,
                    course_content: order.course_content || order.course_type,
                    actual_price: actualPrice,
                    price: actualPrice,
                    status: order.real_status,
                    created_at: order.created_at,
                    updated_at: order.updated_at,
                    booking_time: order.booking_time,
                    // 添加评价状态字段
                    user_evaluation_status: this.getUserEvaluationStatus(order.booking_session_id),
                    merchant_evaluation_status: this.getMerchantEvaluationStatus(order.booking_session_id)
                };
            });

            // 获取总数
            const total = db.prepare(`
                SELECT COUNT(*) as count 
                FROM orders o
                LEFT JOIN merchants m ON o.merchant_id = m.id
                LEFT JOIN regions r ON o.region_id = r.id
                LEFT JOIN booking_sessions bs ON o.booking_session_id = bs.id
                WHERE ${whereClause}
            `).get(...params);

            return {
                success: true,
                data: {
                    orders,
                    total: total.count,
                    page,
                    pageSize,
                    totalPages: Math.ceil(total.count / pageSize)
                }
            };
        } catch (error) {
            console.error('获取订单列表失败:', error);
            throw new Error('获取订单列表失败: ' + error.message);
        }
    }

    // 获取用户评价状态
    getUserEvaluationStatus(bookingSessionId) {
        try {
            const evaluation = db.prepare(`
                SELECT status, detailed_scores, overall_score FROM evaluations 
                WHERE booking_session_id = ? AND evaluator_type = 'user'
            `).get(bookingSessionId);
            
            // 用户评价：status为completed即视为已完成评价
            // 用户评价主要通过12项详细评分，不依赖overall_score
            if (evaluation && evaluation.status === 'completed') {
                return 'completed';
            }
            return 'pending';
        } catch (error) {
            return 'pending';
        }
    }
    
    // 获取商家评价状态
    getMerchantEvaluationStatus(bookingSessionId) {
        try {
            const evaluation = db.prepare(`
                SELECT status, detailed_scores, overall_score FROM evaluations 
                WHERE booking_session_id = ? AND evaluator_type = 'merchant'
            `).get(bookingSessionId);
            
            // 商家评价：status为completed即视为已完成评价
            // 包括简单评价（选择"不了👋"）和详细评价
            return evaluation && evaluation.status === 'completed' ? 'completed' : 'pending';
        } catch (error) {
            return 'pending';
        }
    }

    // 获取订单详情
    async getOrderById({ params }) {
        try {
            const orderId = params.id;
            
            const order = db.prepare(`
                SELECT 
                    o.*,
                    m.id as merchant_db_id,
                    m.teacher_name as merchant_name,
                    m.username as merchant_username,
                    m.contact as teacher_contact,
                    m.price1,
                    m.price2,
                    r.name as region_name,
                    bs.user_course_status,
                    bs.merchant_course_status,
                    bs.updated_at as completion_time
                FROM orders o
                LEFT JOIN merchants m ON o.merchant_id = m.id
                LEFT JOIN regions r ON o.region_id = r.id
                LEFT JOIN booking_sessions bs ON o.booking_session_id = bs.id
                WHERE o.id = ?
            `).get(orderId);

            if (!order) {
                throw new Error('订单不存在');
            }

            // 计算实际价格
            let actualPrice = order.actual_price;
            if (!actualPrice || actualPrice === 0) {
                if (order.course_type === 'p' && order.price1) {
                    actualPrice = order.price1;
                } else if (order.course_type === 'pp' && order.price2) {
                    actualPrice = order.price2;
                } else if (order.course_type === 'other') {
                    actualPrice = '其他时长';
                } else {
                    actualPrice = '未设置';
                }
            }

            // 确定订单真实状态
            let realStatus = 'pending';
            if (order.user_course_status === 'completed') {
                realStatus = 'completed';
            } else if (order.user_course_status === 'confirmed' || order.status === 'confirmed') {
                realStatus = 'confirmed';
            } else if (order.status === 'cancelled') {
                realStatus = 'cancelled';
            }

            // 获取评价数据
            const userEvaluation = db.prepare(`
                SELECT overall_score, detailed_scores, comments as text_comment, status, created_at
                FROM evaluations 
                WHERE booking_session_id = ? AND evaluator_type = 'user'
            `).get(order.booking_session_id);

            const merchantEvaluation = db.prepare(`
                SELECT overall_score, detailed_scores, comments as text_comment, status, created_at
                FROM evaluations 
                WHERE booking_session_id = ? AND evaluator_type = 'merchant'
            `).get(order.booking_session_id);

            // 时间处理
            const formatTime = (timestamp) => {
                if (!timestamp) return null;
                if (typeof timestamp === 'number' || /^\d+$/.test(timestamp)) {
                    return new Date(parseInt(timestamp) * 1000).toISOString();
                }
                return timestamp;
            };

            // 构建处理后的订单数据
            const processedOrder = {
                id: order.id,
                order_number: order.order_number || order.id,
                user_name: order.user_name || '未知用户',
                user_username: order.user_username,
                merchant_id: order.merchant_id,
                merchant_name: order.merchant_name || '未知商家',
                teacher_contact: order.teacher_contact,
                region: order.region_name || '未知地区',
                course_type: order.course_type,
                course_content: order.course_content || order.course_type,
                price: actualPrice,
                actual_price: actualPrice,
                status: realStatus,
                booking_time: order.booking_time,
                created_at: order.created_at,
                updated_at: order.updated_at,
                completion_time: formatTime(order.completion_time),
                user_evaluation_status: this.getUserEvaluationStatus(order.booking_session_id),
                merchant_evaluation_status: this.getMerchantEvaluationStatus(order.booking_session_id),
                user_evaluation: userEvaluation ? {
                    overall_score: userEvaluation.overall_score,
                    scores: userEvaluation.detailed_scores ? JSON.parse(userEvaluation.detailed_scores) : {},
                    comments: userEvaluation.text_comment,
                    created_at: formatTime(userEvaluation.created_at)
                } : null,
                merchant_evaluation: merchantEvaluation ? {
                    overall_score: merchantEvaluation.overall_score,
                    scores: merchantEvaluation.detailed_scores ? JSON.parse(merchantEvaluation.detailed_scores) : {},
                    comments: merchantEvaluation.text_comment,
                    created_at: formatTime(merchantEvaluation.created_at)
                } : null
            };

            return {
                success: true,
                data: processedOrder
            };
        } catch (error) {
            console.error('获取订单详情失败:', error);
            throw new Error('获取订单详情失败: ' + error.message);
        }
    }

    // 获取地区列表
    async getRegions() {
        try {
            const regions = db.prepare(`
                SELECT id, name FROM regions ORDER BY sort_order, name
            `).all();

            return { data: regions };
        } catch (error) {
            console.error('获取地区列表失败:', error);
            throw new Error('获取地区列表失败: ' + error.message);
        }
    }

    // 获取商家列表
    async getMerchants() {
        try {
            const merchants = dbOperations.getAllMerchants();
            return { data: merchants };
        } catch (error) {
            console.error('获取商家数据失败:', error);
            throw new Error('获取商家数据失败: ' + error.message);
        }
    }

    // 创建新商家
    async createMerchant({ body }) {
        try {
            if (!body.teacher_name || !body.username) {
                throw new Error('商家名称和用户名不能为空');
            }
            
            let bindCode;
            let bindCodeRecord;
            
            // 如果提供了绑定码，验证其有效性
            if (body.bind_code) {
                bindCodeRecord = dbOperations.getBindCode(body.bind_code);
                if (!bindCodeRecord) {
                    throw new Error('提供的绑定码无效或已被使用');
                }
                bindCode = body.bind_code;
            } else {
                // 如果没有提供绑定码，自动创建一个
                bindCodeRecord = dbOperations.createBindCode(`管理员创建: ${body.teacher_name}`);
                if (!bindCodeRecord) {
                    throw new Error('创建绑定码失败');
                }
                bindCode = bindCodeRecord.code;
            }
            
            // 尝试通过用户名自动检测Telegram ID
            let detectedUserId = null;
            const username = body.username.replace('@', '');
            
            try {
                // 方法1：尝试查找数据库中是否有相同用户名的记录（不区分大小写）
                const existingUser = db.prepare('SELECT user_id FROM merchants WHERE LOWER(username) = LOWER(?) AND user_id IS NOT NULL LIMIT 1').get(username);
                if (existingUser && existingUser.user_id) {
                    detectedUserId = existingUser.user_id;
                    console.log(`✅ 从数据库中找到用户ID: ${detectedUserId} (通过历史记录)`);
                }
                
                if (!detectedUserId) {
                    console.log(`⚠️ 无法自动检测用户名 @${username} 的Telegram ID，将等待用户主动绑定`);
                }
            } catch (detectionError) {
                console.log(`⚠️ 自动检测用户ID失败: ${detectionError.message}`);
            }
            
            // 创建商家记录
            const merchantData = {
                user_id: detectedUserId, // 如果检测到了就直接设置，否则为null等待绑定
                username: username,
                bind_code: bindCode,
                bind_step: 5, // 直接设置为完成状态
                status: 'active',
                teacher_name: body.teacher_name
            };
            
            const merchantId = dbOperations.createMerchantSimple(merchantData);
            
            if (!merchantId) {
                throw new Error('创建商家记录失败');
            }
            
            // 如果检测到了用户ID，标记绑定码为已使用
            if (detectedUserId) {
                dbOperations.useBindCode(bindCode, detectedUserId);
            }
            
            const message = detectedUserId 
                ? `商家创建成功，已自动检测到Telegram ID: ${detectedUserId}` 
                : '商家创建成功，等待用户使用绑定码进行绑定';
            
            return { 
                success: true, 
                merchantId, 
                bindCode: bindCode,
                detectedUserId,
                message
            };
        } catch (error) {
            console.error('创建商家失败:', error);
            throw new Error('创建商家失败: ' + error.message);
        }
    }
    
    // 获取绑定码
    async getBindCodes() {
        try {
            const bindCodes = dbOperations.getAllBindCodes();
            return { data: bindCodes };
        } catch (error) {
            console.error('获取绑定码失败:', error);
            throw new Error('获取绑定码失败: ' + error.message);
        }
    }
    
    // 创建绑定码
    async createBindCode({ body }) {
        try {
            const description = body.description || '管理员创建';
            const code = dbOperations.createBindCode(description);
            return code;
        } catch (error) {
            console.error('创建绑定码失败:', error);
            throw new Error('创建绑定码失败: ' + error.message);
        }
    }
    
    // 删除绑定码
    async deleteBindCode({ params }) {
        try {
            // 检查绑定码的依赖关系
            const dependencies = dbOperations.checkBindCodeDependencies(params.id);
            
            if (!dependencies.exists) {
                throw new Error('绑定码不存在');
            }
            
            if (!dependencies.canDelete) {
                const errorMsg = dependencies.merchant 
                    ? `绑定码已被商家 ${dependencies.merchant.teacher_name} 使用，无法删除。如需强制删除，请使用强制删除功能。`
                    : '绑定码已被使用，无法删除。如需强制删除，请使用强制删除功能。';
                throw new Error(errorMsg);
            }
            
            const result = dbOperations.deleteBindCode(params.id);
            return { 
                success: true, 
                status: 200,
                message: '绑定码删除成功',
                data: {
                    deletedCount: result.changes
                }
            };
        } catch (error) {
            console.error('删除绑定码失败:', error);
            throw new Error('删除绑定码失败: ' + error.message);
        }
    }
    
    // 强制删除绑定码（包括已使用的）
    async forceDeleteBindCode({ params }) {
        try {
            const result = dbOperations.forceDeleteBindCode(params.id);
            
            return { 
                success: true, 
                status: 200,
                message: result.deletedMerchant ? '绑定码及相关商家记录已强制删除' : '绑定码已删除',
                data: {
                    deletedMerchant: result.deletedMerchant
                }
            };
        } catch (error) {
            console.error('强制删除绑定码失败:', error);
            throw new Error('强制删除绑定码失败: ' + error.message);
        }
    }

    // 获取商家排名
    async getMerchantRankings({ query }) {
        try {
            console.log('getMerchantRankings 查询参数:', query);
            
            const filters = this.parseFilters(query);
            console.log('解析后的筛选条件:', filters);
            
            let whereConditions = ['1=1'];
            let params = [];

            // 构建基础查询条件
            if (filters.regionId && filters.regionId !== 'all') {
                whereConditions.push('m.region_id = ?');
                params.push(filters.regionId);
                console.log('添加地区筛选:', filters.regionId);
            }

            if (filters.priceRange && filters.priceRange !== 'all') {
                whereConditions.push(`
                    CASE 
                        WHEN m.price1 IS NOT NULL AND m.price2 IS NOT NULL THEN 
                            CASE 
                                WHEN (m.price1 + m.price2) / 2 <= 500 THEN '0-500'
                                WHEN (m.price1 + m.price2) / 2 <= 1000 THEN '500-1000'
                                WHEN (m.price1 + m.price2) / 2 <= 2000 THEN '1000-2000'
                                ELSE '2000+'
                            END
                        WHEN m.price1 IS NOT NULL THEN
                            CASE 
                                WHEN m.price1 <= 500 THEN '0-500'
                                WHEN m.price1 <= 1000 THEN '500-1000'
                                WHEN m.price1 <= 2000 THEN '1000-2000'
                                ELSE '2000+'
                            END
                        ELSE '未设置'
                    END = ?
                `);
                params.push(filters.priceRange);
                console.log('添加价格筛选:', filters.priceRange);
            }

            // 添加时间筛选条件（处理Unix时间戳）
            if (filters.dateFrom) {
                const fromTimestamp = Math.floor(new Date(filters.dateFrom + 'T00:00:00').getTime() / 1000);
                whereConditions.push('(o.created_at IS NULL OR o.created_at >= ?)');
                params.push(fromTimestamp);
                console.log('添加开始时间筛选:', filters.dateFrom, '时间戳:', fromTimestamp);
            }
            if (filters.dateTo) {
                const toTimestamp = Math.floor(new Date(filters.dateTo + 'T23:59:59').getTime() / 1000);
                whereConditions.push('(o.created_at IS NULL OR o.created_at <= ?)');
                params.push(toTimestamp);
                console.log('添加结束时间筛选:', filters.dateTo, '时间戳:', toTimestamp);
            }

            const whereClause = whereConditions.join(' AND ');
            console.log('最终WHERE子句:', whereClause);
            console.log('查询参数:', params);

            const sql = `
                SELECT 
                    m.id,
                    m.teacher_name,
                    m.username,
                    r.name as region_name,
                    COUNT(DISTINCT o.id) as totalOrders,
                    COUNT(DISTINCT CASE WHEN bs.user_course_status = 'completed' THEN o.id END) as completedOrders,
                    AVG(CASE WHEN e.overall_score IS NOT NULL THEN e.overall_score END) as avgRating,
                    COUNT(DISTINCT e.id) as totalEvaluations,
                    SUM(CASE WHEN bs.user_course_status = 'completed' AND o.price_range IS NOT NULL 
                        THEN CAST(o.price_range AS REAL) ELSE 0 END) as totalRevenue,
                    CASE 
                        WHEN m.price1 IS NOT NULL AND m.price2 IS NOT NULL THEN 
                            ROUND((m.price1 + m.price2) / 2)
                        WHEN m.price1 IS NOT NULL THEN m.price1
                        WHEN m.price2 IS NOT NULL THEN m.price2
                        ELSE 0
                    END as avgPrice,
                    CASE 
                        WHEN COUNT(o.id) > 0 
                        THEN ROUND(COUNT(CASE WHEN bs.user_course_status = 'completed' THEN 1 END) * 100.0 / COUNT(o.id), 1)
                        ELSE 0 
                    END as completionRate
                FROM merchants m
                LEFT JOIN regions r ON m.region_id = r.id
                LEFT JOIN orders o ON m.id = o.merchant_id
                LEFT JOIN booking_sessions bs ON o.booking_session_id = bs.id
                LEFT JOIN evaluations e ON bs.id = e.booking_session_id AND e.evaluator_type = 'user'
                WHERE ${whereClause}
                GROUP BY m.id, m.teacher_name, m.username, r.name
                ORDER BY completedOrders DESC, totalOrders DESC, avgRating DESC
                LIMIT 50
            `;
            
            console.log('执行SQL查询:', sql);
            
            const rankings = db.prepare(sql).all(...params);
            
            console.log('查询结果数量:', rankings.length);
            console.log('前3个结果:', rankings.slice(0, 3));

            return { data: rankings };
        } catch (error) {
            console.error('getMerchantRankings 错误:', error);
            throw new Error('获取商家排名失败: ' + error.message);
        }
    }

    // 获取用户排名
    async getUserRankings({ query }) {
        try {
            const filters = this.parseFilters(query);
            let whereConditions = ['1=1'];
            let params = [];

            // 添加时间筛选条件（处理Unix时间戳）
            if (filters.dateFrom) {
                const fromTimestamp = Math.floor(new Date(filters.dateFrom + 'T00:00:00').getTime() / 1000);
                whereConditions.push('(o.created_at IS NULL OR o.created_at >= ?)');
                params.push(fromTimestamp);
            }
            if (filters.dateTo) {
                const toTimestamp = Math.floor(new Date(filters.dateTo + 'T23:59:59').getTime() / 1000);
                whereConditions.push('(o.created_at IS NULL OR o.created_at <= ?)');
                params.push(toTimestamp);
            }

            const whereClause = whereConditions.join(' AND ');

            const rankings = db.prepare(`
                SELECT 
                    o.user_id,
                    o.user_name,
                    o.user_username,
                    COUNT(DISTINCT o.id) as totalOrders,
                    COUNT(DISTINCT CASE WHEN bs.user_course_status = 'completed' THEN o.id END) as completedOrders,
                    AVG(CASE WHEN e.overall_score IS NOT NULL THEN e.overall_score END) as avgRating,
                    COUNT(DISTINCT e.id) as totalEvaluations,
                    SUM(CASE WHEN bs.user_course_status = 'completed' AND o.price_range IS NOT NULL 
                        THEN CAST(o.price_range AS REAL) ELSE 0 END) as totalSpent,
                    CASE 
                        WHEN COUNT(o.id) > 0 
                        THEN ROUND(COUNT(CASE WHEN bs.user_course_status = 'completed' THEN 1 END) * 100.0 / COUNT(o.id), 1)
                        ELSE 0 
                    END as completionRate,
                    CASE 
                        WHEN o.user_name IS NOT NULL AND o.user_name != '未设置' AND o.user_name != '' 
                        THEN o.user_name
                        WHEN o.user_username IS NOT NULL AND o.user_username != '未设置' AND o.user_username != ''
                        THEN '@' || o.user_username
                        ELSE '用户' || o.user_id
                    END as displayName
                FROM orders o
                LEFT JOIN booking_sessions bs ON o.booking_session_id = bs.id
                LEFT JOIN evaluations e ON bs.id = e.booking_session_id AND e.evaluator_type = 'merchant'
                WHERE ${whereClause} AND o.user_id IS NOT NULL
                GROUP BY o.user_id, o.user_name, o.user_username
                HAVING totalOrders > 0
                ORDER BY completedOrders DESC, avgRating DESC, totalOrders DESC
                LIMIT 50
            `).all(...params);

            return { data: rankings };
        } catch (error) {
            throw new Error('获取用户排名失败: ' + error.message);
        }
    }

    // 获取缓存信息
    async getCacheInfo() {
        try {
            // 延迟加载statsService
            let cacheStats = {};
            try {
                const statsService = require('./statsService');
                cacheStats = statsService.getCacheStats();
            } catch (error) {
                console.warn('统计服务暂不可用:', error.message);
                cacheStats = { error: '统计服务暂不可用' };
            }
            
            return { data: cacheStats };
        } catch (error) {
            throw new Error('获取缓存信息失败: ' + error.message);
        }
    }

    // 解析筛选条件
    parseFilters(query) {
        const filters = {};
        
        if (query.timeRange) {
            const now = new Date();
            const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
            
            switch (query.timeRange) {
                case 'today':
                case '本日':
                    filters.dateFrom = today.toISOString().split('T')[0];
                    filters.dateTo = today.toISOString().split('T')[0];
                    break;
                case 'week':
                case '本周':
                    // 本周开始（周一）
                    const weekStart = new Date(today);
                    weekStart.setDate(today.getDate() - today.getDay() + 1);
                    filters.dateFrom = weekStart.toISOString().split('T')[0];
                    filters.dateTo = today.toISOString().split('T')[0];
                    break;
                case 'month':
                case '本月':
                    // 本月开始
                    const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
                    filters.dateFrom = monthStart.toISOString().split('T')[0];
                    filters.dateTo = today.toISOString().split('T')[0];
                    break;
                case 'quarter':
                case '本季度':
                    // 本季度开始
                    const quarter = Math.floor(today.getMonth() / 3);
                    const quarterStart = new Date(today.getFullYear(), quarter * 3, 1);
                    filters.dateFrom = quarterStart.toISOString().split('T')[0];
                    filters.dateTo = today.toISOString().split('T')[0];
                    break;
                case 'year':
                case '本年':
                    // 本年开始
                    const yearStart = new Date(today.getFullYear(), 0, 1);
                    filters.dateFrom = yearStart.toISOString().split('T')[0];
                    filters.dateTo = today.toISOString().split('T')[0];
                    break;
            }
        }

        // 基础筛选条件
        if (query.dateFrom) filters.dateFrom = query.dateFrom;
        if (query.dateTo) filters.dateTo = query.dateTo;
        if (query.regionId) filters.regionId = query.regionId;
        if (query.priceRange) filters.priceRange = query.priceRange;
        if (query.merchantId) filters.merchantId = query.merchantId;
        if (query.status) filters.status = query.status;
        if (query.courseType) filters.courseType = query.courseType;
        
        // 新增搜索条件
        if (query.search) filters.search = query.search.trim();
        if (query.orderId) filters.orderId = query.orderId;
        if (query.userName && query.userName.trim()) filters.userName = query.userName.trim();
        if (query.merchantName && query.merchantName.trim()) filters.merchantName = query.merchantName.trim();
        if (query.minPrice && !isNaN(query.minPrice)) filters.minPrice = parseFloat(query.minPrice);
        if (query.maxPrice && !isNaN(query.maxPrice)) filters.maxPrice = parseFloat(query.maxPrice);
        if (query.evaluationStatus) filters.evaluationStatus = query.evaluationStatus;

        return filters;
    }

    // 计算订单实际价格
    calculateOrderPrice(order) {
        // 如果订单有明确价格且不是"未设置"，使用订单价格
        if (order.price && order.price !== '未设置' && !isNaN(order.price)) {
            return parseInt(order.price);
        }
        
        // 根据课程类型匹配商家价格
        if (order.course_content === 'p' && order.price1) {
            return order.price1;
        } else if (order.course_content === 'pp' && order.price2) {
            return order.price2;
        }
        
        // 如果没有匹配，返回课程类型提示
        if (order.course_content === 'p') {
            return '待定价(p服务)';
        } else if (order.course_content === 'pp') {
            return '待定价(pp服务)';
        }
        
        return '价格未设置';
    }

    // 构建WHERE条件
    buildWhereConditions(filters) {
        const conditions = ['1=1'];
        const params = [];

        // 时间筛选 - 使用Unix时间戳
        if (filters.dateFrom) {
            conditions.push('date(o.created_at, "unixepoch") >= ?');
            params.push(filters.dateFrom);
        }

        if (filters.dateTo) {
            conditions.push('date(o.created_at, "unixepoch") <= ?');
            params.push(filters.dateTo);
        }

        // 商家筛选 - 支持按商家ID或老师名称
        if (filters.merchantId) {
            conditions.push('(o.merchant_id = ? OR m.teacher_name = ?)');
            params.push(filters.merchantId);
            params.push(filters.merchantId); // 当作老师名称搜索
        }

        // 地区筛选 - 修正为通过商家的地区筛选，因为大多数订单的region_id为空
        if (filters.regionId) {
            conditions.push('(o.region_id = ? OR m.region_id = ?)');
            params.push(filters.regionId, filters.regionId);
        }

        // 价格区间筛选 - 支持多种价格表示方式
        if (filters.priceRange) {
            switch (filters.priceRange) {
                case '0-500':
                    conditions.push(`(
                        (o.actual_price IS NOT NULL AND CAST(o.actual_price AS REAL) BETWEEN 0 AND 500) OR
                        (o.price_range LIKE '%500%' AND o.price_range NOT LIKE '%1000%') OR
                        (o.course_type = 'p' AND m.price1 IS NOT NULL AND CAST(m.price1 AS REAL) BETWEEN 0 AND 500) OR
                        (o.course_type = 'pp' AND m.price2 IS NOT NULL AND CAST(m.price2 AS REAL) BETWEEN 0 AND 500)
                    )`);
                    break;
                case '500-1000':
                    conditions.push(`(
                        (o.actual_price IS NOT NULL AND CAST(o.actual_price AS REAL) BETWEEN 500 AND 1000) OR
                        (o.price_range LIKE '%1000%' AND o.price_range NOT LIKE '%2000%') OR
                        (o.course_type = 'p' AND m.price1 IS NOT NULL AND CAST(m.price1 AS REAL) BETWEEN 500 AND 1000) OR
                        (o.course_type = 'pp' AND m.price2 IS NOT NULL AND CAST(m.price2 AS REAL) BETWEEN 500 AND 1000)
                    )`);
                    break;
                case '1000-2000':
                    conditions.push(`(
                        (o.actual_price IS NOT NULL AND CAST(o.actual_price AS REAL) BETWEEN 1000 AND 2000) OR
                        (o.price_range LIKE '%2000%' OR o.price_range LIKE '%1500%') OR
                        (o.course_type = 'p' AND m.price1 IS NOT NULL AND CAST(m.price1 AS REAL) BETWEEN 1000 AND 2000) OR
                        (o.course_type = 'pp' AND m.price2 IS NOT NULL AND CAST(m.price2 AS REAL) BETWEEN 1000 AND 2000)
                    )`);
                    break;
                case '2000+':
                    conditions.push(`(
                        (o.actual_price IS NOT NULL AND CAST(o.actual_price AS REAL) > 2000) OR
                        (o.price_range LIKE '%3000%' OR o.price_range LIKE '%4000%' OR o.price_range LIKE '%5000%') OR
                        (o.course_type = 'p' AND m.price1 IS NOT NULL AND CAST(m.price1 AS REAL) > 2000) OR
                        (o.course_type = 'pp' AND m.price2 IS NOT NULL AND CAST(m.price2 AS REAL) > 2000)
                    )`);
                    break;
            }
        }

        // 状态筛选 - 简化逻辑，主要基于orders表的status字段
        if (filters.status) {
            switch (filters.status) {
                case 'confirmed':
                    conditions.push("o.status = 'confirmed'");
                    break;
                case 'pending':
                    conditions.push("o.status = 'pending'");
                    break;
                case 'attempting':
                    conditions.push("o.status = 'attempting'");
                    break;
                case 'cancelled':
                    conditions.push("o.status = 'cancelled'");
                    break;
                case 'failed':
                    conditions.push("o.status = 'failed'");
                    break;
                case 'completed':
                    // 完成状态可能在booking_sessions中，也可能在orders中
                    conditions.push("(o.status = 'completed' OR bs.user_course_status = 'completed')");
                    break;
                default:
                    // 如果是其他状态，直接匹配
                    conditions.push("o.status = ?");
                    params.push(filters.status);
            }
        }

        // 课程类型筛选 - 支持p, pp, other
        if (filters.courseType) {
            conditions.push('o.course_type = ?');
            params.push(filters.courseType);
        }

        // 全文搜索 - 支持搜索订单号、用户名、商家名、课程内容
        if (filters.search) {
            conditions.push(`(
                CAST(o.id AS TEXT) LIKE ? OR 
                o.order_number LIKE ? OR
                o.user_username LIKE ? OR 
                o.user_name LIKE ? OR 
                m.teacher_name LIKE ? OR 
                m.username LIKE ? OR 
                o.course_content LIKE ? OR
                CAST(o.actual_price AS TEXT) LIKE ? OR
                o.price_range LIKE ?
            )`);
            const searchTerm = `%${filters.search}%`;
            params.push(searchTerm, searchTerm, searchTerm, searchTerm, searchTerm, searchTerm, searchTerm, searchTerm, searchTerm);
        }

        // 精确订单号搜索
        if (filters.orderId) {
            conditions.push('(CAST(o.id AS TEXT) = ? OR o.order_number = ?)');
            params.push(filters.orderId.toString(), filters.orderId.toString());
        }

        // 用户名搜索
        if (filters.userName) {
            conditions.push('(o.user_username LIKE ? OR o.user_name LIKE ?)');
            const userSearchTerm = `%${filters.userName}%`;
            params.push(userSearchTerm, userSearchTerm);
        }

        // 商家名搜索
        if (filters.merchantName) {
            conditions.push('(m.teacher_name LIKE ? OR m.username LIKE ?)');
            const merchantSearchTerm = `%${filters.merchantName}%`;
            params.push(merchantSearchTerm, merchantSearchTerm);
        }

        // 价格范围筛选 - 支持最小/最大价格
        if (filters.minPrice && !isNaN(filters.minPrice)) {
            conditions.push(`(
                (o.actual_price IS NOT NULL AND CAST(o.actual_price AS REAL) >= ?) OR
                (o.price_range IS NOT NULL AND o.price_range != '未设置' AND o.price_range != '待确定价格' AND CAST(REPLACE(o.price_range, '.0', '') AS REAL) >= ?) OR
                (o.course_type = 'p' AND m.price1 IS NOT NULL AND CAST(m.price1 AS REAL) >= ?) OR
                (o.course_type = 'pp' AND m.price2 IS NOT NULL AND CAST(m.price2 AS REAL) >= ?)
            )`);
            params.push(filters.minPrice, filters.minPrice, filters.minPrice, filters.minPrice);
        }

        if (filters.maxPrice && !isNaN(filters.maxPrice)) {
            conditions.push(`(
                (o.actual_price IS NOT NULL AND CAST(o.actual_price AS REAL) <= ?) OR
                (o.price_range IS NOT NULL AND o.price_range != '未设置' AND o.price_range != '待确定价格' AND CAST(REPLACE(o.price_range, '.0', '') AS REAL) <= ?) OR
                (o.course_type = 'p' AND m.price1 IS NOT NULL AND CAST(m.price1 AS REAL) <= ?) OR
                (o.course_type = 'pp' AND m.price2 IS NOT NULL AND CAST(m.price2 AS REAL) <= ?)
            )`);
            params.push(filters.maxPrice, filters.maxPrice, filters.maxPrice, filters.maxPrice);
        }

        // 评价状态筛选 - 由于production环境evaluations表为空，暂时简化
        if (filters.evaluationStatus) {
            switch (filters.evaluationStatus) {
                case 'user_completed':
                    conditions.push(`EXISTS (
                        SELECT 1 FROM evaluations e 
                        WHERE e.booking_session_id = o.booking_session_id 
                        AND e.evaluator_type = 'user' 
                        AND e.status = 'completed'
                    )`);
                    break;
                case 'user_pending':
                    conditions.push(`NOT EXISTS (
                        SELECT 1 FROM evaluations e 
                        WHERE e.booking_session_id = o.booking_session_id 
                        AND e.evaluator_type = 'user' 
                        AND e.status = 'completed'
                    ) OR o.booking_session_id IS NULL`);
                    break;
                case 'merchant_completed':
                    conditions.push(`EXISTS (
                        SELECT 1 FROM evaluations e 
                        WHERE e.booking_session_id = o.booking_session_id 
                        AND e.evaluator_type = 'merchant' 
                        AND e.status = 'completed'
                    )`);
                    break;
                case 'merchant_pending':
                    conditions.push(`NOT EXISTS (
                        SELECT 1 FROM evaluations e 
                        WHERE e.booking_session_id = o.booking_session_id 
                        AND e.evaluator_type = 'merchant' 
                        AND e.status = 'completed'
                    ) OR o.booking_session_id IS NULL`);
                    break;
                case 'all_completed':
                    conditions.push(`EXISTS (
                        SELECT 1 FROM evaluations e 
                        WHERE e.booking_session_id = o.booking_session_id 
                        AND e.evaluator_type = 'user' 
                        AND e.status = 'completed'
                    ) AND EXISTS (
                        SELECT 1 FROM evaluations e 
                        WHERE e.booking_session_id = o.booking_session_id 
                        AND e.evaluator_type = 'merchant' 
                        AND e.status = 'completed'
                    )`);
                    break;
                case 'none_completed':
                    conditions.push(`(NOT EXISTS (
                        SELECT 1 FROM evaluations e 
                        WHERE e.booking_session_id = o.booking_session_id 
                        AND e.evaluator_type = 'user' 
                        AND e.status = 'completed'
                    ) AND NOT EXISTS (
                        SELECT 1 FROM evaluations e 
                        WHERE e.booking_session_id = o.booking_session_id 
                        AND e.evaluator_type = 'merchant' 
                        AND e.status = 'completed'
                    )) OR o.booking_session_id IS NULL`);
                    break;
            }
        }

        return { conditions, params };
    }

    // Dashboard需要的基础API方法
    async getBasicStats({ headers = {} }) {
        try {
            // 检查是否需要强制刷新
            const forceRefresh = headers['x-force-refresh'] === 'true';
            
            if (forceRefresh) {
                console.log('🔄 强制刷新统计数据...');
                // 清理所有可能的缓存
                if (global.statsCache) {
                    global.statsCache.clear();
                }
            }
            
            // 获取各种基础统计数据
            const totalMerchants = db.prepare('SELECT COUNT(*) as count FROM merchants').get().count;
            const activeMerchants = db.prepare("SELECT COUNT(*) as count FROM merchants WHERE status = 'active'").get().count;
            const totalBindCodes = db.prepare('SELECT COUNT(*) as count FROM bind_codes').get().count;
            const totalRegions = db.prepare('SELECT COUNT(*) as count FROM regions').get().count;
            const totalTemplates = db.prepare('SELECT COUNT(*) as count FROM message_templates').get().count;
            const totalOrders = db.prepare('SELECT COUNT(*) as count FROM orders').get().count;
            const completedOrders = db.prepare("SELECT COUNT(*) as count FROM orders WHERE status = 'completed'").get().count;
            const pendingOrders = db.prepare("SELECT COUNT(*) as count FROM orders WHERE status IN ('attempting', 'pending')").get().count;
            
            // 获取真实的点击统计 - 只统计用户点击"预约老师课程"按钮的次数
            const attackClicks = db.prepare('SELECT COUNT(*) as count FROM interactions WHERE action_type = ?').get('attack_click').count;
            const totalClicks = attackClicks; // 总点击数就是预约按钮点击数
            
            console.log(`点击统计详情: 预约点击=${attackClicks}, 总点击数=${totalClicks}`);
            console.log(`商家统计: 总数=${totalMerchants}, 活跃=${activeMerchants}`);
            console.log(`订单统计: 总数=${totalOrders}, 完成=${completedOrders}, 待处理=${pendingOrders}`);
            
            // 获取交互统计
            const interactionStats = dbOperations.getInteractionStats();
            
            const stats = {
                totalMerchants,
                activeMerchants,
                totalBindCodes,
                totalRegions,
                totalTemplates,
                totalOrders,
                completedOrders,
                pendingOrders,
                totalClicks,
                attackClicks,
                lastUpdated: new Date().toISOString(),
                ...interactionStats
            };
            
            console.log('基础统计数据:', stats);
            return { data: stats };
        } catch (error) {
            console.error('获取基础统计失败:', error);
            throw new Error('获取基础统计失败: ' + error.message);
        }
    }

    async getMerchantBookings() {
        try {
            const bookings = dbOperations.getMerchantBookingStats();
            return { data: bookings };
        } catch (error) {
            throw new Error('获取商家预约统计失败: ' + error.message);
        }
    }

    async getRecentBookings() {
        try {
            const bookings = dbOperations.getRecentBookings(20);
            return { data: bookings };
        } catch (error) {
            throw new Error('获取最近预约失败: ' + error.message);
        }
    }

    async getMessageStats() {
        try {
            const stats = dbOperations.getMessageStats();
            return { data: stats };
        } catch (error) {
            throw new Error('获取消息统计失败: ' + error.message);
        }
    }

    async getButtonStats() {
        try {
            const stats = dbOperations.getButtonClickStats();
            return { data: stats };
        } catch (error) {
            throw new Error('获取按钮统计失败: ' + error.message);
        }
    }

    async getEvaluationStats() {
        try {
            const stats = dbOperations.getEvaluationStats();
            return { data: stats };
        } catch (error) {
            throw new Error('获取评价统计失败: ' + error.message);
        }
    }

    async getEvaluations() {
        try {
            const evaluations = dbOperations.getAllEvaluations();
            return { data: evaluations };
        } catch (error) {
            throw new Error('获取评价列表失败: ' + error.message);
        }
    }

    async getEvaluationDetails({ params }) {
        try {
            const evaluationId = params.id;
            const details = dbOperations.getEvaluationDetails(evaluationId);
            if (!details) {
                throw new Error('评价不存在');
            }
            return { data: details };
        } catch (error) {
            throw new Error('获取评价详情失败: ' + error.message);
        }
    }

    // 简单计数方法
    async getSimpleCount({ params }) {
        try {
            const tableName = params.table;
            
            // 安全的表名映射
            const tableMap = {
                'merchants': 'merchants',
                'message_templates': 'message_templates',
                'bind_codes': 'bind_codes',
                'regions': 'regions',
                'orders': 'orders'
            };
            
            const actualTable = tableMap[tableName];
            if (!actualTable) {
                throw new Error('无效的表名');
            }
            
            const result = db.prepare(`SELECT COUNT(*) as count FROM ${actualTable}`).get();
            
            return {
                success: true,
                count: result.count || 0
            };
        } catch (error) {
            console.error('获取计数失败:', error);
            throw new Error('获取计数失败: ' + error.message);
        }
    }

    // 导出所有数据
    async exportAllData({ body }) {
        try {
            const { format = 'json' } = body;
            console.log('开始数据导出，格式:', format);
            
            const result = await this.dataExportService.exportAllData(format);
            
            return {
                data: result,
                message: '数据导出成功'
            };
        } catch (error) {
            console.error('数据导出失败:', error);
            throw new Error(`数据导出失败: ${error.message}`);
        }
    }

    // 获取导出历史
    async getExportHistory() {
        try {
            const history = this.dataExportService.getExportHistory();
            
            return {
                data: history.map(item => ({
                    filename: item.filename,
                    size: this.formatFileSize(item.size),
                    created: item.created.toISOString(),
                    downloadUrl: `/api/export/download/${item.filename}`
                })),
                message: '获取导出历史成功'
            };
        } catch (error) {
            console.error('获取导出历史失败:', error);
            throw error;
        }
    }

    // 下载导出文件
    async downloadExport({ params }) {
        try {
            const { filename } = params;
            const history = this.dataExportService.getExportHistory();
            const exportFile = history.find(item => item.filename === filename);
            
            if (!exportFile) {
                throw new Error('导出文件不存在');
            }

            return {
                data: {
                    filePath: exportFile.path,
                    filename: exportFile.filename,
                    size: exportFile.size
                },
                message: '文件准备就绪'
            };
        } catch (error) {
            console.error('下载导出文件失败:', error);
            throw error;
        }
    }

    // 清理旧的导出文件
    async cleanupOldExports({ body }) {
        try {
            const { keepCount = 5 } = body;
            const deletedCount = this.dataExportService.cleanupOldExports(keepCount);
            
            return {
                data: { deletedCount },
                message: `已清理 ${deletedCount} 个旧导出文件`
            };
        } catch (error) {
            console.error('清理导出文件失败:', error);
            throw error;
        }
    }

    // 刷新所有数据（重新加载缓存等）
    async refreshAllData() {
        try {
            console.log('开始刷新所有数据...');
            
            // 清理可能的缓存
            if (global.statsCache) {
                global.statsCache.clear();
            }
            
            // 重新计算统计数据
            const stats = await this.getOptimizedStats({ query: {} });
            
            console.log('数据刷新完成');
            
            return {
                data: {
                    refreshTime: new Date().toISOString(),
                    stats: stats.data
                },
                message: '数据刷新成功'
            };
        } catch (error) {
            console.error('刷新数据失败:', error);
            throw error;
        }
    }

    // 格式化文件大小
    formatFileSize(bytes) {
        if (bytes === 0) return '0 Bytes';
        
        const k = 1024;
        const sizes = ['Bytes', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    }

    // 商家接口
    async toggleMerchantStatus({ params }) {
        try {
            const merchantId = params.id;
            const status = params.status;
            
            const result = dbOperations.toggleMerchantStatus(merchantId, status);
            
            return {
                success: true,
                result
            };
        } catch (error) {
            console.error('更新商家状态失败:', error);
            throw new Error('更新商家状态失败: ' + error.message);
        }
    }

    async checkMerchantsFollowStatus({ body }) {
        try {
            const merchantIds = body.merchantIds;
            
            const result = await dbOperations.checkMerchantsFollowStatus(merchantIds);
            
            return {
                success: true,
                result
            };
        } catch (error) {
            console.error('检查商家关注状态失败:', error);
            throw new Error('检查商家关注状态失败: ' + error.message);
        }
    }

    async testSingleMerchantFollowStatus({ body }) {
        try {
            const { merchantId } = body;
            if (!merchantId) {
                throw new Error('请提供商家ID');
            }
            
            const merchant = dbOperations.getMerchantById(merchantId);
            if (!merchant) {
                throw new Error('商家不存在');
            }
            
            console.log(`🔍 测试商家关注状态: ${merchant.teacher_name} (${merchant.username})`);
            
            const result = await dbOperations.checkSingleMerchantFollowStatus(merchantId);
            
            // 添加详细的调试信息
            const debugInfo = {
                merchant_info: {
                    id: merchant.id,
                    teacher_name: merchant.teacher_name,
                    username: merchant.username,
                    user_id: merchant.user_id
                },
                follow_status: result
            };
            
            // 如果有用户名，查找交互记录
            if (merchant.username) {
                const userRecord = dbOperations.getUserRecordByUsername(merchant.username);
                if (userRecord) {
                    debugInfo.user_record = userRecord;
                    debugInfo.interaction_count = dbOperations.getInteractionCount(userRecord.user_id);
                    
                    // 查找最近的状态更新
                    const { db } = require('../config/database');
                    const recentStatusStmt = db.prepare(`
                        SELECT action_type, timestamp, first_name, last_name
                        FROM interactions 
                        WHERE user_id = ? AND action_type LIKE 'status_%' 
                        ORDER BY timestamp DESC 
                        LIMIT 5
                    `);
                    debugInfo.recent_status_updates = recentStatusStmt.all(userRecord.user_id);
                } else {
                    debugInfo.user_record = null;
                    debugInfo.interaction_count = 0;
                    debugInfo.recent_status_updates = [];
                }
            }
            
            return {
                success: true,
                result: debugInfo
            };
        } catch (error) {
            console.error('测试商家关注状态失败:', error);
            throw new Error('测试商家关注状态失败: ' + error.message);
        }
    }

    // 获取缓存或执行函数
    async getCachedOrExecute(cacheKey, executeFn, customTimeout = null) {
        const timeout = customTimeout || this.cacheTimeout;
        const cached = this.requestCache.get(cacheKey);
        
        if (cached && (Date.now() - cached.timestamp) < timeout) {
            return { ...cached.data, fromCache: true };
        }
        
        const result = await executeFn();
        this.requestCache.set(cacheKey, {
            data: result,
            timestamp: Date.now()
        });
        
        return { ...result, fromCache: false };
    }

    // 商家报告相关方法

    // 获取报告模板配置
    async getMerchantReportTemplates() {
        try {
            const templates = this.merchantReportService.getReportTemplates();
            
            // 获取所有商家列表
            const merchants = dbOperations.getAllMerchants()
                .filter(m => m.status === 'active')
                .map(m => ({
                    id: m.id,
                    name: m.teacher_name || m.username || `商家${m.id}`,
                    username: m.username
                }));

            return {
                data: {
                    templates,
                    merchants
                },
                message: '获取报告模板和商家列表成功'
            };
        } catch (error) {
            console.error('获取报告模板失败:', error);
            throw new Error('获取报告模板失败');
        }
    }

    // 生成商家报告
    async generateMerchantReport({ body }) {
        try {
            const { merchantId, year, month } = body;
            
            if (!merchantId || !year || !month) {
                throw new Error('缺少必要参数：merchantId, year, month');
            }

            // 验证商家是否存在
            const merchant = dbOperations.getMerchantById(merchantId);
            if (!merchant) {
                throw new Error('商家不存在');
            }

            // 生成报告
            const report = await this.merchantReportService.generateMerchantMonthlyReport(
                merchantId, 
                parseInt(year), 
                parseInt(month)
            );

            return {
                data: report,
                message: '生成商家报告成功'
            };

        } catch (error) {
            console.error('生成商家报告失败:', error);
            throw new Error(error.message || '生成商家报告失败');
        }
    }

    // 发送商家报告
    async sendMerchantReport({ body }) {
        try {
            const { merchantId, year, month, selectedSections, sendToBot = true } = body;
            
            if (!merchantId || !year || !month) {
                throw new Error('缺少必要参数：merchantId, year, month');
            }

            // 生成报告
            const report = await this.merchantReportService.generateMerchantMonthlyReport(
                merchantId, 
                parseInt(year), 
                parseInt(month)
            );

            // 生成报告文本
            const reportText = this.merchantReportService.generateReportText(report, selectedSections);

            let result = {
                reportText,
                message: '报告生成成功'
            };

            // 如果需要发送到Bot
            if (sendToBot) {
                try {
                    // 延迟加载botService避免循环依赖
                    const botService = require('./botService');
                    const merchant = report.merchant;
                    
                    if (merchant.user_id) {
                        // 获取bot实例并直接发送消息
                        const bot = botService.getBotInstance();
                        if (bot) {
                            await bot.sendMessage(merchant.user_id, reportText, {
                                parse_mode: 'HTML'
                            });
                            result.message = '报告已发送给商家';
                            result.sent = true;
                        } else {
                            result.message = '报告生成成功，但Bot实例未初始化，无法发送';
                            result.sent = false;
                        }
                    } else {
                        result.message = '报告生成成功，但商家未绑定用户ID，无法发送';
                        result.sent = false;
                    }
                } catch (sendError) {
                    console.error('发送报告到Bot失败:', sendError);
                    result.message = '报告生成成功，但发送失败：' + sendError.message;
                    result.sent = false;
                }
            }

            return {
                data: result,
                message: result.message
            };

        } catch (error) {
            console.error('发送商家报告失败:', error);
            throw new Error(error.message || '发送商家报告失败');
        }
    }

    // 获取商家月度排名
    async getMerchantMonthlyRanking({ params }) {
        try {
            const { year, month } = params;
            
            if (!year || !month) {
                throw new Error('缺少必要参数：year, month');
            }

            const rankings = await this.merchantReportService.calculateMonthlyRankings(
                parseInt(year), 
                parseInt(month)
            );

            return {
                data: rankings,
                message: '获取商家排名成功'
            };

        } catch (error) {
            console.error('获取商家排名失败:', error);
            throw new Error(error.message || '获取商家排名失败');
        }
    }

    // 刷新商家排名缓存
    async refreshMerchantRanking({ body }) {
        try {
            const { year, month } = body;
            
            if (!year || !month) {
                throw new Error('缺少必要参数：year, month');
            }

            // 清除缓存
            const cacheKey = `ranking_${year}_${month}`;
            this.merchantReportService.rankingCache.delete(cacheKey);

            // 重新计算排名
            const rankings = await this.merchantReportService.calculateMonthlyRankings(
                parseInt(year), 
                parseInt(month)
            );

            return {
                data: rankings,
                message: '刷新商家排名成功'
            };

        } catch (error) {
            console.error('刷新商家排名失败:', error);
            throw new Error(error.message || '刷新商家排名失败');
        }
    }

    // 获取用户月度排名
    async getUserMonthlyRanking({ params }) {
        try {
            const { year, month } = params;
            const cacheKey = `user_ranking_${year}_${month}`;
            
            // 尝试从缓存获取
            if (this.cache && this.cache.has && this.cache.has(cacheKey)) {
                return this.cache.get(cacheKey);
            }

            // 获取用户统计数据 - 基于现有数据库结构
            const userStats = db.prepare(`
                SELECT 
                    o.user_id as userId,
                    o.user_name,
                    o.user_username,
                    COUNT(DISTINCT o.id) as totalOrders,
                    COUNT(DISTINCT CASE WHEN bs.user_course_status = 'completed' THEN o.id END) as completedOrders,
                    AVG(CASE WHEN e.overall_score IS NOT NULL THEN e.overall_score END) as avgMerchantScore,
                    COUNT(DISTINCT e.id) as receivedEvaluations,
                    SUM(CASE WHEN bs.user_course_status = 'completed' AND o.price_range IS NOT NULL 
                        THEN CAST(o.price_range AS REAL) ELSE 0 END) as totalSpent,
                    -- 计算用户活跃度分数（基于订单创建时间）
                    COUNT(DISTINCT DATE(datetime(o.created_at, 'unixepoch'))) as activeDays,
                    -- 计算课程完成率
                    CASE WHEN COUNT(o.id) > 0 
                        THEN ROUND(COUNT(CASE WHEN bs.user_course_status = 'completed' THEN 1 END) * 100.0 / COUNT(o.id), 2)
                        ELSE 0 END as completionRate
                FROM orders o
                LEFT JOIN booking_sessions bs ON o.booking_session_id = bs.id
                LEFT JOIN evaluations e ON bs.id = e.booking_session_id AND e.evaluator_type = 'merchant'
                WHERE o.user_id IS NOT NULL
                    AND strftime('%Y', datetime(o.created_at, 'unixepoch')) = ?
                    AND strftime('%m', datetime(o.created_at, 'unixepoch')) = ?
                GROUP BY o.user_id, o.user_name, o.user_username
                HAVING totalOrders > 0
                ORDER BY 
                    completedOrders DESC,
                    avgMerchantScore DESC,
                    completionRate DESC,
                    totalSpent DESC
            `).all(year.toString(), month.toString().padStart(2, '0'));

            // 计算综合评分和排名
            const rankedUsers = userStats.map((user, index) => {
                // 综合评分算法
                const completedWeight = 0.5;      // 完成订单数权重
                const scoreWeight = 0.3;          // 商家评价权重
                const completionWeight = 0.15;    // 完成率权重
                const activityWeight = 0.05;      // 活跃度权重

                const normalizedCompleted = Math.min(user.completedOrders / 10, 1); // 归一化到0-1
                const normalizedScore = (user.avgMerchantScore || 0) / 5;
                const normalizedCompletion = user.completionRate / 100;
                const normalizedActivity = Math.min(user.activeDays / 15, 1);

                const comprehensiveScore = (
                    normalizedCompleted * completedWeight +
                    normalizedScore * scoreWeight +
                    normalizedCompletion * completionWeight +
                    normalizedActivity * activityWeight
                ) * 100;

                // 用户等级评定
                let userLevel = '';
                let levelIcon = '';
                if (comprehensiveScore >= 85) {
                    userLevel = '钻石学员';
                    levelIcon = '💎';
                } else if (comprehensiveScore >= 70) {
                    userLevel = '黄金学员';
                    levelIcon = '🥇';
                } else if (comprehensiveScore >= 55) {
                    userLevel = '白银学员';
                    levelIcon = '🥈';
                } else if (comprehensiveScore >= 40) {
                    userLevel = '青铜学员';
                    levelIcon = '🥉';
                } else {
                    userLevel = '新手学员';
                    levelIcon = '🌟';
                }

                return {
                    ...user,
                    rank: index + 1,
                    comprehensiveScore: Math.round(comprehensiveScore * 10) / 10,
                    userLevel,
                    levelIcon,
                    displayName: user.user_name && user.user_name !== '未设置' && user.user_name !== ''
                        ? user.user_name
                        : (user.user_username && user.user_username !== '未设置' && user.user_username !== '' ? '@' + user.user_username : `用户${user.userId}`),
                    avgMerchantScore: user.avgMerchantScore ? parseFloat(user.avgMerchantScore).toFixed(1) : '暂无',
                    avgUserScore: '暂无', // 暂时不支持用户给出的评价
                    totalSpent: Math.round(user.totalSpent || 0)
                };
            });

            const result = {
                year: parseInt(year),
                month: parseInt(month),
                totalUsers: rankedUsers.length,
                rankings: rankedUsers,
                updateTime: new Date().toISOString(),
                summary: {
                    diamondUsers: rankedUsers.filter(u => u.userLevel === '钻石学员').length,
                    goldUsers: rankedUsers.filter(u => u.userLevel === '黄金学员').length,
                    silverUsers: rankedUsers.filter(u => u.userLevel === '白银学员').length,
                    bronzeUsers: rankedUsers.filter(u => u.userLevel === '青铜学员').length,
                    newUsers: rankedUsers.filter(u => u.userLevel === '新手学员').length,
                    avgCompletionRate: rankedUsers.length > 0 
                        ? (rankedUsers.reduce((sum, u) => sum + u.completionRate, 0) / rankedUsers.length).toFixed(1)
                        : 0,
                    avgScore: rankedUsers.length > 0 
                        ? (rankedUsers.reduce((sum, u) => sum + (parseFloat(u.avgMerchantScore) || 0), 0) / rankedUsers.length).toFixed(1)
                        : 0
                }
            };

            // 缓存结果（24小时）
            if (this.cache && this.cache.set) {
                this.cache.set(cacheKey, result, 24 * 60 * 60 * 1000);
            }

            return {
                data: result,
                message: '获取用户排名成功'
            };

        } catch (error) {
            console.error('获取用户排名失败:', error);
            throw new Error('获取用户排名失败: ' + error.message);
        }
    }

    // 刷新用户排名
    async refreshUserRanking({ body }) {
        try {
            const { year, month } = body;
            
            if (!year || !month) {
                throw new Error('年份和月份不能为空');
            }

            // 清除相关缓存
            const cacheKey = `user_ranking_${year}_${month}`;
            if (this.cache && this.cache.delete) {
                this.cache.delete(cacheKey);
            }

            // 重新计算排名
            const ranking = await this.getUserMonthlyRanking({ params: { year, month } });

            return {
                message: '用户排名刷新成功',
                data: ranking.data
            };

        } catch (error) {
            console.error('刷新用户排名失败:', error);
            throw new Error('刷新用户排名失败: ' + error.message);
        }
    }
}

module.exports = new ApiService(); 