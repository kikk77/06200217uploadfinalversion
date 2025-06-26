// 订单管理系统 - 优化版本
// 版本: 20250625-1659 - 修复双向评价筛选和显示问题
console.log('📋 订单管理系统加载 - 版本: 20250625-1659');

class OptimizedOrdersManager {
    constructor() {
        // 基础配置
        this.currentPage = 1;
        this.pageSize = 50; // 增加页面大小以减少请求次数
        this.totalPages = 1;
        this.totalOrders = 0;
        
        // 缓存管理
        this.cache = new Map();
        this.cacheTimeout = 5 * 60 * 1000; // 5分钟缓存
        
        // 图表实例
        this.charts = {};
        this.chartsLoaded = new Set();
        
        // 虚拟滚动配置
        this.virtualScroll = {
            itemHeight: 60,
            containerHeight: 500,
            visibleItems: 0,
            scrollTop: 0,
            totalItems: 0,
            renderBuffer: 5
        };
        
        // 懒加载观察器
        this.lazyObserver = null;
        
        // 防抖定时器
        this.debounceTimers = {};
        
        this.init();
    }

    init() {
        this.setupEventListeners();
        this.loadInitialData();
        
        // 延迟加载图表以避免阻塞页面渲染
        setTimeout(() => {
            console.log('开始加载所有图表...');
            this.loadAllCharts();
        }, 1000);
    }

    // 设置懒加载
    setupLazyLoading() {
        if ('IntersectionObserver' in window) {
            this.lazyObserver = new IntersectionObserver((entries) => {
                entries.forEach(entry => {
                    if (entry.isIntersecting) {
                        const chartId = entry.target.dataset.chartId;
                        if (chartId && !this.chartsLoaded.has(chartId)) {
                            this.loadChart(chartId);
                            this.chartsLoaded.add(chartId);
                            this.lazyObserver.unobserve(entry.target);
                        }
                    }
                });
            }, {
                rootMargin: '50px 0px', // 提前50px开始加载
                threshold: 0.1
            });

            // 观察所有图表容器
            document.querySelectorAll('.chart-container canvas').forEach(canvas => {
                canvas.dataset.chartId = canvas.id;
                this.lazyObserver.observe(canvas);
            });
        } else {
            // 降级处理：直接加载所有图表
            this.loadAllCharts();
        }
    }

    // 设置虚拟滚动
    setupVirtualScroll() {
        const tableContainer = document.querySelector('.table-container');
        if (!tableContainer) return;

        const tbody = document.getElementById('ordersTableBody');
        if (!tbody) return;

        // 创建虚拟滚动容器
        const virtualContainer = document.createElement('div');
        virtualContainer.className = 'virtual-scroll-container';
        virtualContainer.style.height = `${this.virtualScroll.containerHeight}px`;
        virtualContainer.style.overflow = 'auto';
        virtualContainer.style.position = 'relative';

        // 创建内容容器
        const contentContainer = document.createElement('div');
        contentContainer.className = 'virtual-scroll-content';
        contentContainer.style.position = 'relative';

        // 创建可见区域
        const visibleContainer = document.createElement('div');
        visibleContainer.className = 'virtual-scroll-visible';
        visibleContainer.style.position = 'absolute';
        visibleContainer.style.top = '0';
        visibleContainer.style.width = '100%';

        contentContainer.appendChild(visibleContainer);
        virtualContainer.appendChild(contentContainer);

        // 替换原表格容器
        tableContainer.appendChild(virtualContainer);

        // 监听滚动事件
        virtualContainer.addEventListener('scroll', this.debounce(() => {
            this.handleVirtualScroll(virtualContainer, visibleContainer);
        }, 16)); // 60fps

        this.virtualContainer = virtualContainer;
        this.visibleContainer = visibleContainer;
        this.contentContainer = contentContainer;
    }

    // 虚拟滚动处理
    handleVirtualScroll(container, visibleContainer) {
        const scrollTop = container.scrollTop;
        const startIndex = Math.floor(scrollTop / this.virtualScroll.itemHeight);
        const endIndex = Math.min(
            startIndex + Math.ceil(this.virtualScroll.containerHeight / this.virtualScroll.itemHeight) + this.virtualScroll.renderBuffer,
            this.virtualScroll.totalItems
        );

        this.renderVisibleItems(visibleContainer, startIndex, endIndex);
    }

    // 渲染可见项目
    renderVisibleItems(container, startIndex, endIndex) {
        // 清空容器
        container.innerHTML = '';

        // 设置容器位置
        container.style.transform = `translateY(${startIndex * this.virtualScroll.itemHeight}px)`;

        // 渲染可见项目
        for (let i = startIndex; i < endIndex; i++) {
            if (this.ordersData && this.ordersData[i]) {
                const orderElement = this.createOrderElement(this.ordersData[i], i);
                container.appendChild(orderElement);
            }
        }
    }

    // 创建订单元素
    createOrderElement(order, index) {
        const row = document.createElement('div');
        row.className = 'virtual-order-row';
        row.style.height = `${this.virtualScroll.itemHeight}px`;
        row.style.display = 'flex';
        row.style.alignItems = 'center';
        row.style.borderBottom = '1px solid #eee';
        row.style.padding = '0 15px';

        row.innerHTML = `
            <div class="order-cell" style="flex: 1;">${order.order_number}</div>
            <div class="order-cell" style="flex: 1.5;">${order.user_name || order.username || '未知用户'}</div>
            <div class="order-cell" style="flex: 1.5;">${order.merchant_name || '未知商家'}</div>
            <div class="order-cell" style="flex: 1;">${order.course_content || '-'}</div>
            <div class="order-cell" style="flex: 0.8;">${typeof order.actual_price === 'number' ? '¥' + order.actual_price : (order.actual_price || order.price || '未设置')}</div>
            <div class="order-cell" style="flex: 0.8;">
                <span class="status-badge status-${order.status}">${this.getStatusText(order.status)}</span>
            </div>
            <div class="order-cell" style="flex: 1.2;">${this.formatDate(order.created_at)}</div>
            <div class="order-cell" style="flex: 1;">
                ${this.getEvaluationStatusDisplay(order)}
            </div>
            <div class="order-cell" style="flex: 0.8;">
                <button class="btn btn-sm btn-primary" onclick="ordersManager.showOrderDetails('${order.id}')">详情</button>
            </div>
        `;

        return row;
    }

    // 设置事件监听器
    setupEventListeners() {
        // 基础筛选器事件监听
        const timeRange = document.getElementById('timeRange');
        if (timeRange) {
            timeRange.addEventListener('change', (e) => {
                this.handleTimeRangeChange(e.target.value);
            });
        }

        const regionFilter = document.getElementById('regionFilter');
        if (regionFilter) {
            regionFilter.addEventListener('change', () => {
                this.applyFiltersAndRefresh();
            });
        }

        const priceRangeFilter = document.getElementById('priceRangeFilter');
        if (priceRangeFilter) {
            priceRangeFilter.addEventListener('change', () => {
                this.applyFiltersAndRefresh();
            });
        }

        const merchantFilter = document.getElementById('merchantFilter');
        if (merchantFilter) {
            merchantFilter.addEventListener('change', () => {
                this.applyFiltersAndRefresh();
            });
        }

        // 搜索输入防抖
        const searchInput = document.getElementById('searchInput');
        if (searchInput) {
            searchInput.addEventListener('input', (e) => {
                this.debounce(() => {
                    this.searchOrders(e.target.value);
                }, 300)();
            });
        }

        // 高级筛选器事件监听
        const globalSearchInput = document.getElementById('globalSearchInput');
        if (globalSearchInput) {
            globalSearchInput.addEventListener('input', (e) => {
                this.debounce(() => {
                    this.applyAdvancedFilters();
                }, 500)();
            });
        }

        const orderIdFilter = document.getElementById('orderIdFilter');
        if (orderIdFilter) {
            orderIdFilter.addEventListener('input', (e) => {
                this.debounce(() => {
                    this.applyAdvancedFilters();
                }, 500)();
            });
        }

        const userNameFilter = document.getElementById('userNameFilter');
        if (userNameFilter) {
            userNameFilter.addEventListener('input', (e) => {
                this.debounce(() => {
                    this.applyAdvancedFilters();
                }, 500)();
            });
        }

        const merchantNameFilter = document.getElementById('merchantNameFilter');
        if (merchantNameFilter) {
            merchantNameFilter.addEventListener('input', (e) => {
                this.debounce(() => {
                    this.applyAdvancedFilters();
                }, 500)();
            });
        }

        const statusFilter = document.getElementById('statusFilter');
        if (statusFilter) {
            statusFilter.addEventListener('change', () => {
                this.applyAdvancedFilters();
            });
        }

        const courseTypeFilter = document.getElementById('courseTypeFilter');
        if (courseTypeFilter) {
            courseTypeFilter.addEventListener('change', () => {
                this.applyAdvancedFilters();
            });
        }

        const evaluationStatusFilter = document.getElementById('evaluationStatusFilter');
        if (evaluationStatusFilter) {
            evaluationStatusFilter.addEventListener('change', () => {
                this.applyAdvancedFilters();
            });
        }

        const minPriceFilter = document.getElementById('minPriceFilter');
        if (minPriceFilter) {
            minPriceFilter.addEventListener('input', (e) => {
                this.debounce(() => {
                    this.applyAdvancedFilters();
                }, 500)();
            });
        }

        const maxPriceFilter = document.getElementById('maxPriceFilter');
        if (maxPriceFilter) {
            maxPriceFilter.addEventListener('input', (e) => {
                this.debounce(() => {
                    this.applyAdvancedFilters();
                }, 500)();
            });
        }

        const orderDateFrom = document.getElementById('orderDateFrom');
        if (orderDateFrom) {
            orderDateFrom.addEventListener('change', () => {
                this.applyAdvancedFilters();
            });
        }

        const orderDateTo = document.getElementById('orderDateTo');
        if (orderDateTo) {
            orderDateTo.addEventListener('change', () => {
                this.applyAdvancedFilters();
            });
        }

        const regionFilterAdvanced = document.getElementById('regionFilterAdvanced');
        if (regionFilterAdvanced) {
            regionFilterAdvanced.addEventListener('change', () => {
                this.applyAdvancedFilters();
            });
        }

        // 自定义日期范围
        const dateFrom = document.getElementById('dateFrom');
        if (dateFrom) {
            dateFrom.addEventListener('change', () => {
                this.applyFiltersAndRefresh();
            });
        }

        const dateTo = document.getElementById('dateTo');
        if (dateTo) {
            dateTo.addEventListener('change', () => {
                this.applyFiltersAndRefresh();
            });
        }

        // 窗口大小变化时重新计算虚拟滚动
        window.addEventListener('resize', this.debounce(() => {
            this.recalculateVirtualScroll();
        }, 250));

        // 页面可见性变化时刷新数据
        document.addEventListener('visibilitychange', () => {
            if (!document.hidden) {
                this.refreshStaleData();
            }
        });
    }

    // 应用筛选并刷新数据
    async applyFiltersAndRefresh() {
        try {
            this.currentPage = 1; // 重置页码
            await Promise.all([
                this.updateDashboard(),
                this.loadOrders(1, false)
            ]);
        } catch (error) {
            console.error('应用筛选失败:', error);
            this.showError('应用筛选失败: ' + error.message);
        }
    }

    // 防抖函数
    debounce(func, wait, immediate = false) {
        return (...args) => {
            const later = () => {
                if (!immediate) func.apply(this, args);
            };
            const callNow = immediate && !this.debounceTimers[func.name];
            clearTimeout(this.debounceTimers[func.name]);
            this.debounceTimers[func.name] = setTimeout(later, wait);
            if (callNow) func.apply(this, args);
        };
    }

    // 缓存管理
    setCache(key, data, timeout = null) {
        const expireTime = Date.now() + (timeout || this.cacheTimeout);
        this.cache.set(key, {
            data: JSON.parse(JSON.stringify(data)), // 深拷贝
            expireTime,
            timestamp: Date.now()
        });
    }

    getCache(key) {
        const cached = this.cache.get(key);
        if (!cached) return null;
        
        if (Date.now() > cached.expireTime) {
            this.cache.delete(key);
            return null;
        }
        
        return cached.data;
    }

    clearCache(pattern = null) {
        if (pattern) {
            for (const key of this.cache.keys()) {
                if (key.includes(pattern)) {
                    this.cache.delete(key);
                }
            }
        } else {
            this.cache.clear();
        }
    }

    // 获取缓存键
    getCacheKey(type, params = {}) {
        return `${type}_${JSON.stringify(params)}`;
    }

    // 加载初始数据
    async loadInitialData() {
        this.showLoading(true);
        
        try {
            // 并行加载基础数据
            const [regions, merchants] = await Promise.all([
                this.fetchRegions(),
                this.fetchMerchants()
            ]);

            this.populateFilters(regions, merchants);
            
            // 加载仪表板数据
            await this.updateDashboard();
            
            // 加载订单列表
            await this.loadOrders();
            
            // 注意：图表加载现在由调用方控制，避免重复加载

        } catch (error) {
            console.error('加载初始数据失败:', error);
            this.showError('加载数据失败，请刷新页面重试');
        } finally {
            this.showLoading(false);
        }
    }

    // 优化的API请求
    async fetchWithCache(url, params = {}, cacheTimeout = null) {
        const cacheKey = this.getCacheKey(url, params);
        
        // 尝试从缓存获取
        const cached = this.getCache(cacheKey);
        if (cached) {
            return { ...cached, fromCache: true };
        }

        try {
            const queryString = new URLSearchParams(params).toString();
            const fullUrl = queryString ? `${url}?${queryString}` : url;
            
            const response = await fetch(fullUrl);
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }
            
            const data = await response.json();
            
            // 缓存结果
            this.setCache(cacheKey, data, cacheTimeout);
            
            return { ...data, fromCache: false };
            
        } catch (error) {
            console.error(`API请求失败 (${url}):`, error);
            throw error;
        }
    }

    // 懒加载图表
    async loadChart(chartId) {
        try {
            console.log(`开始加载图表: ${chartId}`);
            const canvas = document.getElementById(chartId);
            if (!canvas) {
                console.error(`找不到图表canvas元素: ${chartId}`);
                return;
            }

            // 显示加载指示器
            const container = canvas.closest('.chart-container');
            const loadingDiv = document.createElement('div');
            loadingDiv.className = 'chart-loading';
            loadingDiv.innerHTML = '<div class="loading-spinner"></div><div>加载图表中...</div>';
            container.appendChild(loadingDiv);

            // 获取图表数据
            console.log(`获取图表数据: ${chartId}`);
            const chartData = await this.fetchChartData(chartId);
            console.log(`图表数据获取成功 (${chartId}):`, chartData);
            
            // 创建图表
            console.log(`创建图表: ${chartId}`);
            this.createChart(chartId, chartData);
            console.log(`图表创建完成: ${chartId}`);
            
            // 移除加载指示器
            container.removeChild(loadingDiv);
            
        } catch (error) {
            console.error(`加载图表失败 (${chartId}):`, error);
            this.showChartError(chartId);
        }
    }

    // 获取图表数据
    async fetchChartData(chartId) {
        const filters = this.getCurrentFilters();
        
        let response;
        switch (chartId) {
            case 'ordersChart':
                response = await this.fetchWithCache('/api/charts/orders-trend', filters);
                break;
            case 'regionChart':
                response = await this.fetchWithCache('/api/charts/region-distribution', filters);
                break;
            case 'priceChart':
                response = await this.fetchWithCache('/api/charts/price-distribution', filters);
                break;
            case 'statusChart':
                response = await this.fetchWithCache('/api/charts/status-distribution', filters);
                break;
            default:
                throw new Error(`未知图表类型: ${chartId}`);
        }
        
        // 添加调试信息
        console.log(`图表 ${chartId} 数据:`, response);
        
        // 处理API返回的数据格式
        return response.data || response;
    }

    // 创建图表
    createChart(chartId, data) {
        const canvas = document.getElementById(chartId);
        const ctx = canvas.getContext('2d');

        // 销毁已存在的图表
        if (this.charts[chartId]) {
            this.charts[chartId].destroy();
        }

        const config = this.getChartConfig(chartId, data);
        this.charts[chartId] = new Chart(ctx, config);
    }

    // 获取图表配置
    getChartConfig(chartId, data) {
        const commonOptions = {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    display: true,
                    position: 'top'
                }
            },
            animation: {
                duration: 750,
                easing: 'easeInOutQuart'
            }
        };

        switch (chartId) {
            case 'ordersChart':
                const datasets = [{
                    label: '总订单数',
                            data: data.values || [],
                            borderColor: '#4f46e5',
                            backgroundColor: 'rgba(79, 70, 229, 0.1)',
                            fill: true,
                            tension: 0.4
                }];
                
                // 如果有已完成订单数据，添加第二个数据集
                if (data.completedValues && data.completedValues.length > 0) {
                    datasets.push({
                        label: '已完成订单',
                        data: data.completedValues,
                        borderColor: '#10b981',
                        backgroundColor: 'rgba(16, 185, 129, 0.1)',
                        fill: false,
                        tension: 0.4
                    });
                }
                
                return {
                    type: 'line',
                    data: {
                        labels: data.labels || [],
                        datasets: datasets
                    },
                    options: {
                        ...commonOptions,
                        scales: {
                            y: {
                                beginAtZero: true,
                                ticks: {
                                    precision: 0
                                }
                            }
                        }
                    }
                };

            case 'regionChart':
                return {
                    type: 'pie',
                    data: {
                        labels: data.labels || [],
                        datasets: [{
                            data: data.values || [],
                            backgroundColor: [
                                '#4f46e5', '#06b6d4', '#10b981', 
                                '#f59e0b', '#ef4444', '#8b5cf6'
                            ]
                        }]
                    },
                    options: commonOptions
                };

            case 'priceChart':
                return {
                    type: 'bar',
                    data: {
                        labels: data.labels || [],
                        datasets: [{
                            label: '订单数量',
                            data: data.values || [],
                            backgroundColor: '#10b981'
                        }]
                    },
                    options: {
                        ...commonOptions,
                        scales: {
                            y: {
                                beginAtZero: true,
                                ticks: {
                                    precision: 0
                                }
                            }
                        }
                    }
                };

            case 'statusChart':
                // 状态颜色映射
                const statusColorMap = {
                    '已完成': '#10b981',    // 绿色
                    '已确认': '#004085',    // 蓝色
                    '待确认': '#856404',    // 黄色
                    '未完成': '#856404',    // 黄色
                    '尝试预约': '#0c5460',  // 浅蓝色
                    '预约失败': '#721c24',  // 红色
                    '已取消': '#6c757d'     // 灰色
                };
                
                // 根据标签动态生成颜色数组
                const dynamicColors = (data.labels || []).map(label => 
                    statusColorMap[label] || '#856404' // 默认黄色
                );
                
                return {
                    type: 'doughnut',
                    data: {
                        labels: data.labels || [],
                        datasets: [{
                            data: data.values || [],
                            backgroundColor: dynamicColors
                        }]
                    },
                    options: commonOptions
                };

            default:
                return { type: 'bar', data: { labels: [], datasets: [] }, options: commonOptions };
        }
    }

    // 分页加载订单
    async loadOrders(page = 1, append = false) {
        try {
            const filters = this.getCurrentFilters();
            const params = {
                page,
                pageSize: this.pageSize,
                ...filters
            };

            const response = await this.fetchWithCache('/api/orders', params);
            
            if (response.success) {
                if (append) {
                    this.ordersData = [...(this.ordersData || []), ...response.data.orders];
                } else {
                    this.ordersData = response.data.orders;
                }
                
                this.totalOrders = response.data.total;
                this.totalPages = Math.ceil(this.totalOrders / this.pageSize);
                this.currentPage = page;
                
                // 渲染订单到表格
                this.renderOrdersTable();
                
                // 更新分页信息
                this.updatePaginationInfo();
                
            } else {
                throw new Error(response.message || '加载订单失败');
            }
            
        } catch (error) {
            console.error('加载订单失败:', error);
            this.showError('加载订单失败: ' + error.message);
            
            // 如果加载失败，显示空表格
            this.renderEmptyTable();
        }
    }

    // 渲染订单表格
    renderOrdersTable() {
        const tbody = document.getElementById('ordersTableBody');
        if (!tbody) {
            console.error('找不到ordersTableBody元素');
            return;
        }

        // 清空现有内容
        tbody.innerHTML = '';

        if (!this.ordersData || this.ordersData.length === 0) {
            tbody.innerHTML = `
                <tr>
                    <td colspan="9" style="text-align: center; padding: 2rem; color: #6c757d;">
                        📭 暂无订单数据
                    </td>
                </tr>
            `;
            return;
        }

        // 渲染每个订单
        this.ordersData.forEach(order => {
            const row = this.createOrderTableRow(order);
            tbody.appendChild(row);
        });

        console.log(`已渲染 ${this.ordersData.length} 条订单数据`);
    }

    // 创建订单表格行
    createOrderTableRow(order) {
        const row = document.createElement('tr');
        row.className = 'order-row';
        
        row.innerHTML = `
            <td>${order.order_number || '-'}</td>
            <td>${order.user_name || order.username || '未知用户'}</td>
            <td>${order.merchant_name || '未知商家'}</td>
            <td>${order.course_content || '-'}</td>
            <td>${typeof order.actual_price === 'number' ? '¥' + order.actual_price : (order.actual_price || order.price || '未设置')}</td>
            <td>
                <span class="status-badge status-${order.status}">${this.getStatusText(order.status)}</span>
            </td>
            <td>${this.formatDate(order.created_at)}</td>
            <td>${this.getEvaluationStatusDisplay(order)}</td>
            <td>
                <button class="btn btn-sm btn-primary" onclick="ordersManager.showOrderDetails('${order.id}')">详情</button>
            </td>
        `;

        return row;
    }

    // 渲染空表格
    renderEmptyTable() {
        const tbody = document.getElementById('ordersTableBody');
        if (tbody) {
            tbody.innerHTML = `
                <tr>
                    <td colspan="9" style="text-align: center; padding: 2rem; color: #dc3545;">
                        ❌ 加载订单数据失败，请刷新页面重试
                    </td>
                </tr>
            `;
        }
    }

    // 更新虚拟滚动
    updateVirtualScroll() {
        if (!this.ordersData) return;

        this.virtualScroll.totalItems = this.ordersData.length;
        
        // 更新内容容器高度
        if (this.contentContainer) {
            const totalHeight = this.virtualScroll.totalItems * this.virtualScroll.itemHeight;
            this.contentContainer.style.height = `${totalHeight}px`;
        }

        // 重新渲染可见项目
        if (this.virtualContainer && this.visibleContainer) {
            this.handleVirtualScroll(this.virtualContainer, this.visibleContainer);
        }
    }

    // 无限滚动加载
    setupInfiniteScroll() {
        if (!this.virtualContainer) return;

        this.virtualContainer.addEventListener('scroll', this.debounce(() => {
            const { scrollTop, scrollHeight, clientHeight } = this.virtualContainer;
            
            // 当滚动到底部附近时加载更多
            if (scrollTop + clientHeight >= scrollHeight - 100) {
                if (this.currentPage < this.totalPages && !this.isLoading) {
                    this.loadOrders(this.currentPage + 1, true);
                }
            }
        }, 100));
    }

    // 获取当前筛选条件
    getCurrentFilters() {
        const filters = {};

        // 基础筛选条件
        const timeRange = document.getElementById('timeRange')?.value;
        const dateFrom = document.getElementById('dateFrom')?.value;
        const dateTo = document.getElementById('dateTo')?.value;
        const regionId = document.getElementById('regionFilter')?.value;
        const priceRange = document.getElementById('priceRangeFilter')?.value;
        const merchantId = document.getElementById('merchantFilter')?.value;
        const search = document.getElementById('searchInput')?.value;

        // 高级筛选条件
        const globalSearch = document.getElementById('globalSearchInput')?.value || '';
        const orderId = document.getElementById('orderIdFilter')?.value || '';
        const userName = document.getElementById('userNameFilter')?.value || '';
        const merchantName = document.getElementById('merchantNameFilter')?.value || '';
        const status = document.getElementById('statusFilter')?.value || '';
        const courseType = document.getElementById('courseTypeFilter')?.value || '';
        const evaluationStatus = document.getElementById('evaluationStatusFilter')?.value || '';
        const minPrice = document.getElementById('minPriceFilter')?.value || '';
        const maxPrice = document.getElementById('maxPriceFilter')?.value || '';
        const orderDateFrom = document.getElementById('orderDateFrom')?.value || '';
        const orderDateTo = document.getElementById('orderDateTo')?.value || '';
        const regionAdvanced = document.getElementById('regionFilterAdvanced')?.value || '';

        // 只添加非空的筛选条件
        if (timeRange && timeRange !== '全部') filters.timeRange = timeRange;
        if (dateFrom) filters.dateFrom = dateFrom;
        if (dateTo) filters.dateTo = dateTo;
        if (regionId) filters.regionId = regionId;
        if (priceRange) filters.priceRange = priceRange;
        if (merchantId) filters.merchantId = merchantId;
        if (search) filters.search = search;
        
        // 高级筛选条件（优先级更高）
        if (globalSearch) filters.search = globalSearch;
        if (orderId) filters.orderId = orderId;
        if (userName) filters.userName = userName;
        if (merchantName) filters.merchantName = merchantName;
        if (status) filters.status = status;
        if (courseType) filters.courseType = courseType;
        if (evaluationStatus) filters.evaluationStatus = evaluationStatus;
        if (minPrice) filters.minPrice = parseFloat(minPrice);
        if (maxPrice) filters.maxPrice = parseFloat(maxPrice);
        if (orderDateFrom) filters.dateFrom = orderDateFrom;
        if (orderDateTo) filters.dateTo = orderDateTo;
        if (regionAdvanced) filters.regionId = regionAdvanced;

        console.log('当前筛选条件:', filters);
        return filters;
    }

    // 更新仪表板
    async updateDashboard() {
        try {
            // 强制清除所有缓存，确保获取最新数据
            this.clearCache(); // 清除所有缓存
            
            // 添加时间戳参数防止任何缓存
            const timestamp = Date.now();
            
            // 添加缓存清理头部，强制服务器端也清除缓存
            const headers = {
                'Cache-Control': 'no-cache, no-store, must-revalidate',
                'Pragma': 'no-cache',
                'Expires': '0',
                'X-Force-Refresh': 'true'
            };
            
            // 并行加载优化统计和基础统计
            const filters = this.getCurrentFilters();
            
            const [optimizedResponse, basicResponse] = await Promise.all([
                fetch(`/api/stats/optimized?_t=${timestamp}&` + new URLSearchParams(filters), { headers }),
                fetch(`/api/stats?_t=${timestamp}`, { headers })
            ]);
            
            if (!optimizedResponse.ok || !basicResponse.ok) {
                throw new Error(`API请求失败: ${optimizedResponse.status} ${basicResponse.status}`);
            }
            
            const optimizedData = await optimizedResponse.json();
            const basicData = await basicResponse.json();
            
            // 处理不同的API返回格式
            const optimizedStats = optimizedData.data || optimizedData;
            const basicStats = basicData.data || basicData;
            
            console.log('Orders页面获取到的优化统计数据:', optimizedStats);
            console.log('Orders页面获取到的基础统计数据:', basicStats);
            
            if (optimizedStats) {
                this.updateMetricCards(optimizedStats);
            }
            
            if (basicStats) {
                this.updateBasicStats(basicStats);
            }
            
            // 标记需要重新加载的图表
            this.chartsLoaded.clear();
            
            // 重新观察图表以触发懒加载
            document.querySelectorAll('.chart-container canvas').forEach(canvas => {
                if (this.lazyObserver) {
                    this.lazyObserver.observe(canvas);
                }
            });
            
        } catch (error) {
            console.error('更新仪表板失败:', error);
            this.showError('更新仪表板失败: ' + error.message);
        }
    }

    // 更新指标卡片
    updateMetricCards(data) {
        console.log('📊 收到的优化统计数据:', data);
        
        // 直接映射数据到对应的元素ID
        const elements = {
            'totalOrders': data.totalOrders || 0,
            'bookedOrders': data.bookedOrders || 0,
            'incompleteOrders': data.incompleteOrders || 0,
            'completedOrders': data.completedOrders || 0,
            'avgPrice': data.avgPrice || 0,
            'avgUserRating': data.avgUserRating || 0,
            'avgMerchantRating': data.avgMerchantRating || 0,
            'completionRate': data.completionRate || 0
        };

        console.log('📊 处理后的数据映射:', elements);

        // 更新每个元素
        Object.entries(elements).forEach(([elementId, value]) => {
            const element = document.getElementById(elementId);
            console.log(`📊 更新元素 ${elementId}:`, value, '元素存在:', !!element);
            
            if (element) {
                let displayValue;
                
                switch (elementId) {
                    case 'avgPrice':
                        displayValue = value > 0 ? `¥${value.toLocaleString()}` : '-';
                        break;
                    case 'avgUserRating':
                    case 'avgMerchantRating':
                        displayValue = value > 0 ? `${value}/10` : '-';
                        break;
                    case 'completionRate':
                        displayValue = `${value}%`;
                        break;
                    default:
                        displayValue = value.toLocaleString();
                }
                
                element.textContent = displayValue;
                console.log(`📊 ${elementId} 更新为:`, displayValue);
                } else {
                console.error(`📊 找不到元素: ${elementId}`);
            }
        });
    }

    // 更新基础统计数据
    updateBasicStats(data) {
        console.log('🏪 收到的基础统计数据:', data);
        
        // 直接映射基础统计数据
        const basicElements = {
            'totalMerchants': data.totalMerchants || 0,
            'totalBindCodes': data.totalBindCodes || 0,
            'totalRegions': data.totalRegions || 0,
            'totalTemplates': data.totalTemplates || 0,
            'totalClicks': data.totalClicks || 0
        };

        console.log('🏪 处理后的基础数据映射:', basicElements);

        // 更新每个基础统计元素
        Object.entries(basicElements).forEach(([elementId, value]) => {
            const element = document.getElementById(elementId);
            if (element) {
                element.textContent = value.toLocaleString();
                console.log(`🏪 ${elementId} 更新为:`, value);
            } else {
                console.log(`🏪 未找到基础统计元素: ${elementId}`);
            }
        });

        console.log('🏪 基础统计数据更新完成');
    }

    // 刷新过期数据
    refreshStaleData() {
        const now = Date.now();
        const staleThreshold = 2 * 60 * 1000; // 2分钟

        for (const [key, cached] of this.cache.entries()) {
            if (now - cached.timestamp > staleThreshold) {
                this.cache.delete(key);
            }
        }

        // 如果有过期数据，重新加载
        if (this.cache.size === 0) {
            this.updateDashboard();
            this.loadOrders();
        }
    }

    // 工具方法
    formatDate(timestamp) {
        if (!timestamp || timestamp === 'Invalid Date') return '-';
        
        let date;
        
        // 处理不同的时间格式
        if (typeof timestamp === 'string') {
            // ISO字符串格式
            if (timestamp.includes('T') || timestamp.includes('-')) {
                date = new Date(timestamp);
            } else {
                // 可能是字符串形式的Unix时间戳
                const numericTimestamp = parseInt(timestamp);
                if (!isNaN(numericTimestamp)) {
                    // 判断是秒还是毫秒
                    date = new Date(numericTimestamp < 1e10 ? numericTimestamp * 1000 : numericTimestamp);
                } else {
                    return 'Invalid Date';
                }
            }
        } else if (typeof timestamp === 'number') {
            // 数字时间戳 - 判断是秒还是毫秒
            date = new Date(timestamp < 1e10 ? timestamp * 1000 : timestamp);
        } else if (timestamp instanceof Date) {
            date = timestamp;
        } else {
            return 'Invalid Date';
        }
        
        // 检查日期是否有效
        if (isNaN(date.getTime())) {
            return 'Invalid Date';
        }
        
        return date.toLocaleString('zh-CN', {
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit'
        });
    }

    getStatusText(status) {
        const statusMap = {
            'attempting': '尝试预约',
            'pending': '待确认',
            'confirmed': '已确认', 
            'completed': '已完成',
            'incomplete': '未完成',
            'failed': '预约失败',
            'cancelled': '已取消'
        };
        return statusMap[status] || status;
    }

    showLoading(show) {
        const loading = document.getElementById('loading');
        if (loading) {
            loading.style.display = show ? 'flex' : 'none';
        }
        this.isLoading = show;
    }

    showError(message) {
        // 可以实现更好的错误提示UI
        console.error(message);
        alert(message);
    }

    showChartError(chartId) {
        const canvas = document.getElementById(chartId);
        const container = canvas.closest('.chart-container');
        container.innerHTML = `
            <h3>${container.querySelector('h3').textContent}</h3>
            <div class="chart-error">
                <div>📊</div>
                <div>图表加载失败</div>
                <button onclick="ordersManager.retryLoadChart('${chartId}')">重试</button>
            </div>
        `;
    }

    retryLoadChart(chartId) {
        this.chartsLoaded.delete(chartId);
        this.loadChart(chartId);
    }

    // 公共方法
    async refreshData() {
        console.log('开始刷新所有数据...');
        
        // 1. 强制清除所有浏览器缓存
        if ('caches' in window) {
            try {
                const cacheNames = await caches.keys();
                await Promise.all(cacheNames.map(name => caches.delete(name)));
                console.log('Service Worker缓存已清除');
            } catch (error) {
                console.log('清除Service Worker缓存失败:', error);
            }
        }
        
        // 2. 清除localStorage和sessionStorage
        try {
            localStorage.clear();
            sessionStorage.clear();
            console.log('本地存储已清除');
        } catch (error) {
            console.log('清除本地存储失败:', error);
        }
        
        // 3. 更新刷新按钮状态
        const refreshBtn = document.querySelector('button[onclick="refreshData()"]');
        const originalText = refreshBtn ? refreshBtn.innerHTML : '';
        if (refreshBtn) {
            refreshBtn.innerHTML = '⏳ 强制刷新中...';
            refreshBtn.disabled = true;
        }
        
        // 4. 清除内部缓存
        this.clearCache();
        
        // 5. 重置页面状态
        this.currentPage = 1;
        this.chartsLoaded.clear();
        
        // 6. 显示加载状态
        this.showLoading(true);
        
        try {
            // 7. 强制重新加载，添加随机参数防止任何缓存
            const forceParam = `?_force=${Date.now()}&_random=${Math.random()}`;
            
            // 8. 重新加载基础数据和仪表板
            await this.loadInitialData();
            
            // 9. 重新加载所有图表
            await this.loadAllCharts();
            
            console.log('所有数据刷新完成');
            
            // 10. 显示成功提示
            this.showSuccessMessage('数据强制刷新完成！如仍有缓存问题，请按Ctrl+F5强制刷新页面');
            
        } catch (error) {
            console.error('刷新数据失败:', error);
            this.showError('刷新数据失败: ' + error.message + ' - 建议按Ctrl+F5强制刷新页面');
        } finally {
            this.showLoading(false);
            
            // 11. 恢复刷新按钮状态
            if (refreshBtn) {
                refreshBtn.innerHTML = originalText || '🔄 刷新数据';
                refreshBtn.disabled = false;
            }
        }
    }
    
    // 显示成功消息
    showSuccessMessage(message) {
        // 创建成功提示
        const successDiv = document.createElement('div');
        successDiv.className = 'success-message';
        successDiv.innerHTML = `
            <div class="success-content">
                <span class="success-icon">✅</span>
                <span class="success-text">${message}</span>
            </div>
        `;
        
        // 添加样式
        successDiv.style.cssText = `
            position: fixed;
            top: 20px;
            right: 20px;
            background: #10b981;
            color: white;
            padding: 12px 20px;
            border-radius: 8px;
            box-shadow: 0 4px 12px rgba(0,0,0,0.15);
            z-index: 1000;
            animation: slideInRight 0.3s ease;
        `;
        
        document.body.appendChild(successDiv);
        
        // 3秒后自动移除
        setTimeout(() => {
            if (successDiv.parentNode) {
                successDiv.style.animation = 'slideOutRight 0.3s ease';
                setTimeout(() => successDiv.remove(), 300);
            }
        }, 3000);
    }

    async searchOrders(query) {
        try {
            this.currentPage = 1;
            await this.applyFiltersAndRefresh();
        } catch (error) {
            console.error('搜索订单失败:', error);
            this.showError('搜索失败: ' + error.message);
        }
    }

    async changePage(direction) {
        const newPage = this.currentPage + direction;
        if (newPage >= 1 && newPage <= this.totalPages) {
            await this.loadOrders(newPage);
        }
    }

    updatePaginationInfo() {
        const pageInfo = document.getElementById('pageInfo');
        if (pageInfo) {
            pageInfo.textContent = `第 ${this.currentPage} 页，共 ${this.totalPages} 页`;
        }

        // 更新按钮状态
        const prevBtn = document.getElementById('prevPage');
        const nextBtn = document.getElementById('nextPage');
        
        if (prevBtn) prevBtn.disabled = this.currentPage <= 1;
        if (nextBtn) nextBtn.disabled = this.currentPage >= this.totalPages;
    }

    // 占位方法（需要根据实际API实现）
    async fetchRegions() {
        return await this.fetchWithCache('/api/regions');
    }

    async fetchMerchants() {
        return await this.fetchWithCache('/api/merchants');
    }

    populateFilters(regions, merchants) {
        // 填充地区筛选器
        const regionFilter = document.getElementById('regionFilter');
        if (regionFilter && regions && regions.data) {
            regionFilter.innerHTML = '<option value="">全部地区</option>';
            regions.data.forEach(region => {
                const option = document.createElement('option');
                option.value = region.id;
                option.textContent = region.name;
                regionFilter.appendChild(option);
            });
        }

        // 填充商家筛选器
        const merchantFilter = document.getElementById('merchantFilter');
        if (merchantFilter && merchants && merchants.data) {
            merchantFilter.innerHTML = '<option value="">全部商家</option>';
            merchants.data.forEach(merchant => {
                const option = document.createElement('option');
                option.value = merchant.id;
                option.textContent = merchant.teacher_name || merchant.username || `商家${merchant.id}`;
                merchantFilter.appendChild(option);
            });
        }

        console.log('筛选器填充完成:', {
            regions: regions?.data?.length || 0,
            merchants: merchants?.data?.length || 0
        });
    }

    handleTimeRangeChange(value) {
        // 显示/隐藏自定义日期范围
        const customDateRange = document.getElementById('customDateRange');
        if (customDateRange) {
            customDateRange.style.display = value === 'custom' ? 'flex' : 'none';
        }
        
        // 应用筛选并刷新数据
        this.applyFiltersAndRefresh();
    }

    // 重置筛选器
    resetFilters() {
        document.getElementById('timeRange').value = '全部';
        const regionFilter = document.getElementById('regionFilter');
        if (regionFilter) regionFilter.value = '';
        const priceRangeFilter = document.getElementById('priceRangeFilter');
        if (priceRangeFilter) priceRangeFilter.value = '';
        const merchantFilter = document.getElementById('merchantFilter');
        if (merchantFilter) merchantFilter.value = '';
        const searchInput = document.getElementById('searchInput');
        if (searchInput) searchInput.value = '';
        
        // 隐藏自定义日期范围
        const customDateRange = document.getElementById('customDateRange');
        if (customDateRange) {
            customDateRange.style.display = 'none';
        }
        
        // 清除自定义日期
        const dateFrom = document.getElementById('dateFrom');
        const dateTo = document.getElementById('dateTo');
        if (dateFrom) dateFrom.value = '';
        if (dateTo) dateTo.value = '';
        
        // 应用筛选并刷新数据
        this.applyFiltersAndRefresh();
    }

    // 立即刷新
    refreshDashboard() {
        // 显示加载状态
        this.showLoading(true);
        
        // 清除所有缓存
        this.cache.clear();
        
        // 重新加载所有数据
        Promise.all([
            this.updateDashboard(),
            this.loadOrders(1, false),
            this.loadAllCharts()
        ]).then(() => {
            this.showLoading(false);
            this.showMessage('数据已刷新', 'success');
        }).catch(error => {
            this.showLoading(false);
            this.showError('刷新失败: ' + error.message);
        });
    }

    // 显示消息
    showMessage(message, type = 'info') {
        // 创建消息元素
        const messageEl = document.createElement('div');
        messageEl.className = `message message-${type}`;
        messageEl.textContent = message;
        messageEl.style.cssText = `
            position: fixed;
            top: 20px;
            right: 20px;
            background: ${type === 'success' ? '#d4edda' : type === 'error' ? '#f8d7da' : '#d1ecf1'};
            color: ${type === 'success' ? '#155724' : type === 'error' ? '#721c24' : '#0c5460'};
            padding: 12px 20px;
            border-radius: 8px;
            border: 1px solid ${type === 'success' ? '#c3e6cb' : type === 'error' ? '#f5c6cb' : '#bee5eb'};
            z-index: 10000;
            animation: slideIn 0.3s ease;
        `;
        
        document.body.appendChild(messageEl);
        
        // 3秒后自动移除
        setTimeout(() => {
            messageEl.remove();
        }, 3000);
    }

    recalculateVirtualScroll() {
        // 重新计算虚拟滚动参数
    }

    showOrderDetails(orderId) {
        // 显示订单详情
        this.fetchOrderDetails(orderId);
    }

    async fetchOrderDetails(orderId) {
        try {
            this.showLoading(true);
            const response = await fetch(`/api/orders/${orderId}`);
            const result = await response.json();
            
            if (result.success) {
                this.displayOrderDetailsModal(result.data);
            } else {
                this.showError('获取订单详情失败: ' + (result.error || result.message || '未知错误'));
            }
        } catch (error) {
            console.error('获取订单详情失败:', error);
            this.showError('获取订单详情失败: ' + (error.message || error));
        } finally {
            this.showLoading(false);
        }
    }

    displayOrderDetailsModal(order) {
        try {
            const modal = document.createElement('div');
            modal.className = 'order-details-modal';
            modal.id = 'orderDetailsModal';
        
        modal.innerHTML = `
            <div class="modal-overlay"></div>
            <div class="modal-container">
                <div class="modal-header">
                    <h3 class="modal-title">
                        <span class="order-icon">📋</span>
                        订单详情 - #${order.id}
                    </h3>
                    <button class="modal-close" onclick="this.closest('.order-details-modal').remove()">
                        ×
                    </button>
                </div>
                
                <!-- 基本信息卡片 -->
                <div class="detail-card">
                    <div class="card-title">
                        <span class="card-icon">ℹ️</span>
                        基本信息
                    </div>
                    <div class="card-content">
                        <div class="info-item">
                            <span class="info-label">订单编号</span>
                            <span class="info-value">#${order.id}</span>
                        </div>
                        <div class="info-item">
                            <span class="info-label">用户名</span>
                            <span class="info-value">${order.user_username || '未知用户名'}</span>
                        </div>
                        <div class="info-item">
                            <span class="info-label">用户名称</span>
                            <span class="info-value">${order.user_name || '未知用户名称'}</span>
                        </div>
                        <div class="info-item">
                            <span class="info-label">用户ID</span>
                            <span class="info-value">${order.user_id}</span>
                        </div>
                        <div class="info-item">
                            <span class="info-label">商家ID</span>
                            <span class="info-value">${order.merchant_id}</span>
                        </div>
                        <div class="info-item">
                            <span class="info-label">商家名称</span>
                            <span class="info-value">${order.merchant_name || '未知商家'}</span>
                        </div>
                        <div class="info-item">
                            <span class="info-label">区域</span>
                            <span class="info-value">${order.region || '-'}</span>
                        </div>
                        <div class="info-item">
                            <span class="info-label">联系方式</span>
                            <span class="info-value">${order.teacher_contact || '-'}</span>
                        </div>
                        <div class="info-item">
                            <span class="info-label">课程类型</span>
                            <span class="info-value">${order.course_content || '-'}</span>
                        </div>
                        <div class="info-item">
                            <span class="info-label">价格</span>
                            <span class="info-value price">${typeof order.actual_price === 'number' ? '¥' + order.actual_price : order.actual_price}</span>
                        </div>
                        <div class="info-item">
                            <span class="info-label">状态</span>
                            <span class="status-badge status-${order.status}">${this.getStatusText(order.status)}</span>
                        </div>
                    </div>
                </div>

                <!-- 时间信息卡片 -->
                <div class="detail-card">
                    <div class="card-title">
                        <span class="card-icon">🕒</span>
                        时间信息
                    </div>
                    <div class="card-content">
                        <div class="info-item">
                            <span class="info-label">预约时间</span>
                            <span class="info-value">${this.formatDate(order.booking_time)}</span>
                        </div>
                        <div class="info-item">
                            <span class="info-label">创建时间</span>
                            <span class="info-value">${this.formatDate(order.created_at)}</span>
                        </div>
                        ${order.completion_time ? `
                        <div class="info-item">
                            <span class="info-label">完成时间</span>
                            <span class="info-value">${this.formatDate(order.completion_time)}</span>
                        </div>
                        ` : ''}
                        ${order.user_evaluation_time ? `
                        <div class="info-item">
                            <span class="info-label">用户评价时间</span>
                            <span class="info-value">${this.formatDate(order.user_evaluation_time)}</span>
                        </div>
                        ` : ''}
                        ${order.merchant_evaluation_time ? `
                        <div class="info-item">
                            <span class="info-label">商家评价时间</span>
                            <span class="info-value">${this.formatDate(order.merchant_evaluation_time)}</span>
                        </div>
                        ` : ''}
                    </div>
                </div>
                
                ${order.user_evaluation ? `
                <!-- 用户评价区域 -->
                <div class="evaluation-section">
                    <h3 class="section-title">
                        <span class="section-icon">👤</span>
                        用户评价
                        ${this.getEvaluationTime(order.user_evaluation)}
                    </h3>
                    
                    <!-- 12项评分卡片 -->
                    <div class="detail-card evaluation-scores-card">
                        <div class="card-title">
                            <span class="card-icon">📊</span>
                            评分详情
                        </div>
                        <div class="card-content">
                            ${this.renderEvaluationScores(order.user_evaluation)}
                        </div>
                    </div>
                    
                    <!-- 文字评价卡片 -->
                    <div class="detail-card evaluation-comments-card">
                        <div class="card-title">
                            <span class="card-icon">💬</span>
                            文字评价
                        </div>
                        <div class="card-content">
                            ${this.renderEvaluationComments(order.user_evaluation)}
                        </div>
                    </div>
                </div>
                ` : ''}
                
                ${order.merchant_evaluation ? `
                <!-- 商家评价区域 -->
                <div class="evaluation-section">
                    <h3 class="section-title">
                        <span class="section-icon">👩‍🏫</span>
                        商家评价
                        ${this.getEvaluationTime(order.merchant_evaluation)}
                    </h3>
                    
                    <!-- 12项评分卡片 -->
                    <div class="detail-card evaluation-scores-card">
                        <div class="card-title">
                            <span class="card-icon">📊</span>
                            评分详情
                        </div>
                        <div class="card-content">
                            ${this.renderEvaluationScores(order.merchant_evaluation)}
                        </div>
                    </div>
                    
                    <!-- 文字评价卡片 -->
                    <div class="detail-card evaluation-comments-card">
                        <div class="card-title">
                            <span class="card-icon">💬</span>
                            文字评价
                        </div>
                        <div class="card-content">
                            ${this.renderEvaluationComments(order.merchant_evaluation)}
                        </div>
                    </div>
                </div>
                ` : ''}
                
                ${order.report_content ? `
                <!-- 报告内容卡片 -->
                <div class="detail-card">
                    <div class="card-title">
                        <span class="card-icon">📄</span>
                        报告内容
                    </div>
                    <div class="card-content">
                        <div class="info-item">
                            <span class="info-label">报告详情</span>
                            <span class="info-value">${order.report_content}</span>
                        </div>
                    </div>
                </div>
                ` : ''}
                
                <div class="modal-footer">
                    <button type="button" class="btn btn-primary" onclick="ordersManager.showManualBroadcastDialog('${order.id}')" style="margin-right: 10px;">
                        📢 手动播报
                    </button>
                    <button type="button" class="btn btn-secondary" onclick="this.closest('.order-details-modal').remove()">
                        关闭
                    </button>
                </div>
            </div>
        `;

        // 移除现有模态框
        const existingModal = document.getElementById('orderDetailsModal');
        if (existingModal) {
            existingModal.remove();
        }

        // 添加到页面
        document.body.appendChild(modal);

        // 点击背景关闭
        modal.querySelector('.modal-overlay').addEventListener('click', (e) => {
            if (e.target.classList.contains('modal-overlay')) {
                modal.remove();
            }
        });

        // 阻止模态框内容区域的点击事件冒泡
        modal.querySelector('.modal-container').addEventListener('click', (e) => {
            e.stopPropagation();
        });

        // ESC键关闭
        const handleEscKey = (e) => {
            if (e.key === 'Escape') {
                modal.remove();
                document.removeEventListener('keydown', handleEscKey);
            }
        };
        document.addEventListener('keydown', handleEscKey);

        // 当模态框被移除时清理事件监听器
        const observer = new MutationObserver((mutations) => {
            mutations.forEach((mutation) => {
                if (mutation.type === 'childList') {
                    mutation.removedNodes.forEach((node) => {
                        if (node === modal) {
                            document.removeEventListener('keydown', handleEscKey);
                            observer.disconnect();
                        }
                    });
                }
            });
        });
        observer.observe(document.body, { childList: true });
        } catch (error) {
            console.error('创建订单详情模态框失败:', error);
            this.showError('显示订单详情失败: ' + error.message);
        }
    }

    renderEvaluationScores(evaluationData) {
        try {
            const evaluation = typeof evaluationData === 'string' ? JSON.parse(evaluationData) : evaluationData;
            
            console.log('渲染评分数据:', evaluation);
            
            let html = '';
            
            // 检查是否为简单评价
            if (evaluation.is_simple_evaluation) {
                html += `
                <div class="info-item">
                    <span class="info-label">评价类型</span>
                    <span class="info-value" style="color: #ff9800;">简单评价</span>
                </div>`;
                
                // 显示总体评分（如果有）
                if (evaluation.overall_score !== null && evaluation.overall_score !== undefined) {
                    html += `
                    <div class="info-item">
                        <span class="info-label">出击素质</span>
                        <span class="info-value price">${evaluation.overall_score}/10 ${this.renderStars(evaluation.overall_score)}</span>
                    </div>`;
                }
                
                return html;
            }
            
            // 总体评分 - 无论简单评价还是详细评价都要显示
            if (evaluation.overall_score !== null && evaluation.overall_score !== undefined) {
                html += `
                <div class="info-item">
                    <span class="info-label">出击素质</span>
                    <span class="info-value price">${evaluation.overall_score}/10 ${this.renderStars(evaluation.overall_score)}</span>
                </div>`;
            }
            
            // 详细评分 - 支持商家详细评价的数据结构
            if (evaluation.scores && Object.keys(evaluation.scores).length > 0) {
                // 定义评分项目的显示顺序和标签 - 支持商家详细评价系统
                const scoreLabels = {
                    // 用户评价老师的12项评分
                    'appearance': '颜值',
                    'waist': '腰腹', 
                    'feet': '脚型',
                    'legs': '腿型',
                    'tightness': '松紧',
                    'breasts': '咪咪',
                    'temperament': '气质',
                    'environment': '环境',
                    'sexiness': '骚气',
                    'attitude': '态度',
                    'voice': '叫声',
                    'initiative': '主动',
                    // 商家详细评价项目
                    'length': '鸡鸡长度',
                    'hardness': '鸡鸡硬度',
                    'duration': '单次做爱时间'
                };
                
                // 检查是否为商家详细评价
                const isMerchantEvaluation = evaluation.scores.length || evaluation.scores.hardness || evaluation.scores.duration;
                
                if (isMerchantEvaluation) {
                    // 商家详细评价的显示逻辑
                    html += '<div class="merchant-scores-grid">';
                    
                    const merchantKeys = ['length', 'hardness', 'duration'];
                    merchantKeys.forEach(key => {
                        if (evaluation.scores[key] !== undefined) {
                            const score = evaluation.scores[key];
                            const label = scoreLabels[key];
                            
                            // 特殊处理 duration 字段（可能是文本而不是数字）
                            let displayValue;
                            if (key === 'duration') {
                                if (typeof score === 'string') {
                                    // 转换时间选项为中文显示
                                    const durationMap = {
                                        '1min': '1分钟内',
                                        '3min': '3分钟',
                                        '5min': '5分钟',
                                        '10min': '10分钟',
                                        '15min': '15分钟',
                                        '30min': '30分钟',
                                        '1hour': '1小时以上',
                                        'no': '未出水💦'
                                    };
                                    displayValue = durationMap[score] || score;
                                } else {
                                    displayValue = `${score}/10`;
                                }
                            } else {
                                displayValue = `${score}/10`;
                            }
                            
                            html += `
                            <div class="score-item">
                                <span class="score-label">${label}</span>
                                <span class="score-value">${displayValue}</span>
                            </div>`;
                        }
                    });
                    
                    html += '</div>';
                } else {
                    // 用户评价老师的12项评分显示逻辑
                    const leftColumnKeys = ['appearance', 'waist', 'feet', 'legs', 'tightness', 'breasts'];
                    const rightColumnKeys = ['temperament', 'environment', 'sexiness', 'attitude', 'voice', 'initiative'];
                    
                    // 创建两列布局的评分显示
                    html += '<div class="scores-grid">';
                    
                    // 左列
                    html += '<div class="score-column">';
                    leftColumnKeys.forEach(key => {
                        if (evaluation.scores[key] !== undefined && typeof evaluation.scores[key] === 'number') {
                            const score = evaluation.scores[key];
                            const label = scoreLabels[key];
                            
                            html += `
                            <div class="score-item">
                                <span class="score-label">${label}</span>
                                <span class="score-value">${score}/10</span>
                            </div>`;
                        }
                    });
                    html += '</div>';
                    
                    // 右列
                    html += '<div class="score-column">';
                    rightColumnKeys.forEach(key => {
                        if (evaluation.scores[key] !== undefined && typeof evaluation.scores[key] === 'number') {
                            const score = evaluation.scores[key];
                            const label = scoreLabels[key];
                            
                            html += `
                            <div class="score-item">
                                <span class="score-label">${label}</span>
                                <span class="score-value">${score}/10</span>
                            </div>`;
                        }
                    });
                    html += '</div>';
                    
                    html += '</div>';
                }
            }
            
            // 评分详情卡片不显示评价时间，保持纯净的评分显示
            
            return html || '<div class="info-item"><span class="info-value" style="color: #999;">暂无评分数据</span></div>';
            
        } catch (error) {
            console.error('渲染评分失败:', error);
            return '<div class="info-item"><span class="info-value">评分数据解析失败</span></div>';
        }
    }

    renderEvaluationComments(evaluationData) {
        try {
            const evaluation = typeof evaluationData === 'string' ? JSON.parse(evaluationData) : evaluationData;
            
            console.log('渲染评价内容:', evaluation);
            
            let html = '';
            let commentText = '';
            
            // 检查是否为简单评价
            if (evaluation.is_simple_evaluation) {
                commentText = evaluation.comments || '商家已完成简单评价';
                const commentId = 'comment_' + Math.random().toString(36).substr(2, 9);
                html += `
                <div class="comment-content">
                    <div class="comment-text" id="${commentId}">${commentText}</div>
                    <div class="comment-actions">
                        <button class="copy-evaluation-btn" onclick="ordersManager.copyEvaluationContentById('${commentId}')">
                            📋 复制评价内容
                        </button>
                    </div>
                </div>`;
                
                return html;
            }
            
            // 详细评价的文字内容 - 支持多种数据结构
            let hasTextComment = false;
            
            // 检查 textComment 字段（新的商家详细评价系统）
            if (evaluation.textComment && evaluation.textComment.trim() !== '') {
                commentText = evaluation.textComment;
                hasTextComment = true;
            }
            // 检查 comments 字段（旧系统兼容）
            else if (evaluation.comments && evaluation.comments.trim() !== '') {
                commentText = evaluation.comments;
                hasTextComment = true;
            }
            // 检查 scores.textComment 字段（嵌套结构）
            else if (evaluation.scores && evaluation.scores.textComment && evaluation.scores.textComment.trim() !== '') {
                commentText = evaluation.scores.textComment;
                hasTextComment = true;
            }
            
            if (hasTextComment) {
                const commentId = 'comment_' + Math.random().toString(36).substr(2, 9);
                html += `
                <div class="comment-content">
                    <div class="comment-text" id="${commentId}">${commentText}</div>
                    <div class="comment-actions">
                        <button class="copy-evaluation-btn" onclick="ordersManager.copyEvaluationContentById('${commentId}')">
                            📋 复制评价内容
                        </button>
                    </div>
                </div>`;
            } else {
                html += `
                <div class="comment-content">
                    <div class="comment-text no-comment">暂无文字评价</div>
                </div>`;
            }
            
            return html;
            
        } catch (error) {
            console.error('渲染评价内容失败:', error);
            return '<div class="comment-content"><div class="comment-text">评价内容解析失败</div></div>';
        }
    }

    getEvaluationTime(evaluationData) {
        try {
            if (!evaluationData) return '';
            
            const evaluation = typeof evaluationData === 'string' ? JSON.parse(evaluationData) : evaluationData;
            
            if (evaluation.created_at) {
                return `<span class="evaluation-time">${new Date(evaluation.created_at).toLocaleString('zh-CN')}</span>`;
            }
            
            return '';
        } catch (error) {
            console.error('获取评价时间失败:', error);
            return '';
        }
    }

    // 保留原有的renderEvaluation方法以保持兼容性
    renderEvaluation(evaluationData) {
        try {
            const evaluation = typeof evaluationData === 'string' ? JSON.parse(evaluationData) : evaluationData;
            
            // 详细调试信息
            console.log('渲染评价数据:', evaluation);
            console.log('overall_score类型:', typeof evaluation.overall_score);
            console.log('overall_score值:', evaluation.overall_score);
            console.log('是否为简单评价:', evaluation.is_simple_evaluation);
            
            let html = '';
            
            // 检查是否为简单评价
            if (evaluation.is_simple_evaluation) {
                html += `
                <div class="info-item">
                    <span class="info-label">评价类型</span>
                    <span class="info-value" style="color: #ff9800;">简单评价</span>
                </div>`;
                
                // 显示总体评分（如果有）
                if (evaluation.overall_score !== null && evaluation.overall_score !== undefined) {
                    html += `
                    <div class="info-item">
                        <span class="info-label">出击素质</span>
                        <span class="info-value price">${evaluation.overall_score}/10 ${this.renderStars(evaluation.overall_score)}</span>
                    </div>`;
                } else {
                    console.warn('简单评价但overall_score为空:', evaluation.overall_score);
                }
                
                html += `
                <div class="info-item">
                    <span class="info-label">评价内容</span>
                    <span class="info-value">${evaluation.comments || '商家已完成简单评价'}</span>
                </div>`;
                
                if (evaluation.created_at) {
                    html += `
                    <div class="info-item">
                        <span class="info-label">评价时间</span>
                        <span class="info-value">${new Date(evaluation.created_at).toLocaleString('zh-CN')}</span>
                    </div>`;
                }
                
                return html;
            }
            
            // 总体评分 - 无论简单评价还是详细评价都要显示
            if (evaluation.overall_score !== null && evaluation.overall_score !== undefined) {
                console.log('添加出击素质显示:', evaluation.overall_score);
                html += `
                <div class="info-item">
                    <span class="info-label">出击素质</span>
                    <span class="info-value price">${evaluation.overall_score}/10 ${this.renderStars(evaluation.overall_score)}</span>
                </div>`;
            } else {
                console.log('overall_score不存在或为null:', evaluation.overall_score);
                // 如果是已完成的评价但没有评分，显示提示信息
                if (evaluation.comments || evaluation.scores) {
                    html += `
                    <div class="info-item">
                        <span class="info-label">出击素质</span>
                        <span class="info-value" style="color: #999;">暂无评分</span>
                    </div>`;
                }
            }
            
            // 详细评分 - 使用info-item格式
            if (evaluation.scores && Object.keys(evaluation.scores).length > 0) {
                Object.entries(evaluation.scores).forEach(([key, score]) => {
                    // 使用真实的中文标签映射
                    const labels = {
                        // 硬件评价
                        'appearance': '颜值',
                        'tightness': '松紧',
                        'feet': '脚型',
                        'legs': '腿型',
                        'waist': '腰腹',
                        'breasts': '咪咪',
                        
                        // 软件评价
                        'temperament': '气质',
                        'environment': '环境',
                        'sexiness': '骚气',
                        'attitude': '态度',
                        'voice': '叫声',
                        'initiative': '主动',
                        
                        // 其他可能的标签
                        'service': '服务态度',
                        'skill': '专业技能',
                        'punctuality': '准时性',
                        'communication': '沟通能力',
                        'value': '性价比',
                        'length': '鸡鸡长度',
                        'hardness': '硬度',
                        'duration': '单次做爱时间'
                    };
                    
                    html += `
                    <div class="info-item">
                        <span class="info-label">${labels[key] || key}</span>
                        <span class="info-value">${score}/10</span>
                    </div>`;
                });
            }
            
            // 评价内容
            if (evaluation.comments && !evaluation.is_simple_evaluation) {
                html += `
                <div class="info-item">
                    <span class="info-label">评价内容</span>
                    <span class="info-value">${evaluation.comments}</span>
                </div>`;
            }
            
            // 评价时间
            if (evaluation.created_at && !evaluation.is_simple_evaluation) {
                html += `
                <div class="info-item">
                    <span class="info-label">评价时间</span>
                    <span class="info-value">${new Date(evaluation.created_at).toLocaleString('zh-CN')}</span>
                </div>`;
            }
            
            return html;
            
        } catch (error) {
            console.error('渲染评价失败:', error);
            return '<div class="info-item"><span class="info-value">评价数据解析失败</span></div>';
        }
    }

    renderStars(score) {
        const fullStars = Math.floor(score / 2);
        const halfStar = (score % 2) >= 1;
        const emptyStars = 5 - fullStars - (halfStar ? 1 : 0);
        
        let stars = '';
        for (let i = 0; i < fullStars; i++) {
            stars += '<span class="star star-full">★</span>';
        }
        if (halfStar) {
            stars += '<span class="star star-half">☆</span>';
        }
        for (let i = 0; i < emptyStars; i++) {
            stars += '<span class="star star-empty">☆</span>';
        }
        
        return stars;
    }

    async loadAllCharts() {
        console.log('开始重新加载所有图表...');
        
        // 销毁现有图表
        Object.values(this.charts).forEach(chart => {
            if (chart) {
                chart.destroy();
            }
        });
        this.charts = {};
        
        // 清除图表加载状态
        this.chartsLoaded.clear();
        
        // 并行加载所有图表
        const chartIds = ['ordersChart', 'regionChart', 'priceChart', 'statusChart'];
        const chartPromises = chartIds.map(chartId => {
            return this.loadChart(chartId).catch(error => {
                console.error(`图表 ${chartId} 加载失败:`, error);
                this.showChartError(chartId);
            });
        });
        
        try {
            await Promise.all(chartPromises);
            console.log('所有图表重新加载完成');
        } catch (error) {
            console.error('批量加载图表时出错:', error);
        }
    }

    getEvaluationStatusDisplay(order) {
        const userCompleted = order.user_evaluation_status === 'completed';
        const merchantCompleted = order.merchant_evaluation_status === 'completed';
        
        if (userCompleted && merchantCompleted) {
            return '<span class="eval-complete" style="color: #4caf50; font-weight: 500;">✅ 双向评价</span>';
        } else if (userCompleted && !merchantCompleted) {
            return '<span class="eval-partial" style="color: #2196f3; font-weight: 500;">👤 用户已评</span>';
        } else if (!userCompleted && merchantCompleted) {
            return '<span class="eval-partial" style="color: #ff9800; font-weight: 500;">👩‍🏫 老师已评</span>';
        } else {
            return '<span class="eval-pending" style="color: #9e9e9e; font-weight: 500;">⏳ 未评价</span>';
        }
    }

    // 复制评价内容到剪贴板（通过元素ID）
    copyEvaluationContentById(elementId) {
        try {
            const element = document.getElementById(elementId);
            if (!element) {
                console.error('找不到评价内容元素:', elementId);
                this.showError('复制失败，找不到评价内容');
                return;
            }
            
            // 获取元素的文本内容
            const content = element.textContent || element.innerText || '';
            
            if (!content.trim()) {
                this.showError('评价内容为空');
                return;
            }
            
            // 使用现代剪贴板API
            if (navigator.clipboard && window.isSecureContext) {
                navigator.clipboard.writeText(content).then(() => {
                    this.showSuccessMessage('评价内容已复制到剪贴板');
                    // 添加视觉反馈
                    this.highlightCopiedContent(elementId);
                }).catch(err => {
                    console.error('复制失败:', err);
                    this.fallbackCopyText(content);
                });
            } else {
                // 降级方案
                this.fallbackCopyText(content);
            }
        } catch (error) {
            console.error('复制评价内容失败:', error);
            this.showError('复制失败，请手动选择文本复制');
        }
    }

    // 复制评价内容到剪贴板（直接传入内容，保留兼容性）
    copyEvaluationContent(content) {
        try {
            // 解码HTML实体
            const decodedContent = content.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
            
            // 使用现代剪贴板API
            if (navigator.clipboard && window.isSecureContext) {
                navigator.clipboard.writeText(decodedContent).then(() => {
                    this.showSuccessMessage('评价内容已复制到剪贴板');
                }).catch(err => {
                    console.error('复制失败:', err);
                    this.fallbackCopyText(decodedContent);
                });
            } else {
                // 降级方案
                this.fallbackCopyText(decodedContent);
            }
        } catch (error) {
            console.error('复制评价内容失败:', error);
            this.showError('复制失败，请手动选择文本复制');
        }
    }

    // 降级复制方案
    fallbackCopyText(text) {
        try {
            const textArea = document.createElement('textarea');
            textArea.value = text;
            textArea.style.position = 'fixed';
            textArea.style.left = '-999999px';
            textArea.style.top = '-999999px';
            textArea.style.opacity = '0';
            document.body.appendChild(textArea);
            textArea.focus();
            textArea.select();
            textArea.setSelectionRange(0, text.length);
            
            const successful = document.execCommand('copy');
            document.body.removeChild(textArea);
            
            if (successful) {
                this.showSuccessMessage('评价内容已复制到剪贴板');
            } else {
                this.showError('复制失败，请手动选择文本复制');
            }
        } catch (err) {
            console.error('降级复制方案失败:', err);
            this.showError('复制失败，请手动选择文本复制');
        }
    }

    // 高亮复制的内容（视觉反馈）
    highlightCopiedContent(elementId) {
        try {
            const element = document.getElementById(elementId);
            if (element) {
                element.style.transition = 'background-color 0.3s ease';
                element.style.backgroundColor = '#e3f2fd';
                
                setTimeout(() => {
                    element.style.backgroundColor = '';
                    setTimeout(() => {
                        element.style.transition = '';
                    }, 300);
                }, 1000);
            }
        } catch (error) {
            console.error('高亮效果失败:', error);
        }
    }
    // 刷新所有数据（增强版）
    async refreshAllData() {
        try {
            this.showLoading(true);
            
            const response = await fetch('/api/refresh-data', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                }
            });
            
            const result = await response.json();
            
            if (result.success) {
                // 清除所有缓存
                this.clearCache();
                
                // 重新加载所有数据
                await this.loadInitialData();
                await this.loadAllCharts();
                await this.loadOrders(1, false);
                
                this.showSuccessMessage('数据刷新成功！');
            } else {
                throw new Error(result.message || '刷新失败');
            }
        } catch (error) {
            console.error('刷新数据失败:', error);
            this.showError('刷新数据失败: ' + error.message);
        } finally {
            this.showLoading(false);
        }
    }

    // 显示导出模态框
    showExportModal() {
        const modal = document.getElementById('exportModal');
        if (modal) {
            modal.style.display = 'block';
            this.loadExportHistory();
        }
    }

    // 关闭导出模态框
    closeExportModal() {
        const modal = document.getElementById('exportModal');
        if (modal) {
            modal.style.display = 'none';
        }
    }

    // 开始数据导出
    async startDataExport() {
        try {
            const formatRadios = document.querySelectorAll('input[name="exportFormat"]');
            let format = 'json';
            for (const radio of formatRadios) {
                if (radio.checked) {
                    format = radio.value;
                    break;
                }
            }

            this.showLoading(true);
            this.showSuccessMessage('开始导出数据，请稍候...');

            const response = await fetch('/api/export/all-data', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ format })
            });

            const result = await response.json();

            if (result.success) {
                this.showSuccessMessage('数据导出成功！');
                this.loadExportHistory(); // 刷新导出历史
                
                // 如果有下载链接，自动下载
                if (result.data && result.data.exportPath) {
                    const filename = result.data.exportPath.split('/').pop();
                    this.downloadExportFile(filename);
                }
            } else {
                throw new Error(result.message || '导出失败');
            }
        } catch (error) {
            console.error('数据导出失败:', error);
            this.showError('数据导出失败: ' + error.message);
        } finally {
            this.showLoading(false);
        }
    }

    // 加载导出历史
    async loadExportHistory() {
        try {
            const response = await fetch('/api/export/history');
            const result = await response.json();

            const historyContainer = document.getElementById('exportHistory');
            if (!historyContainer) return;

            if (result.success && result.data && result.data.length > 0) {
                historyContainer.innerHTML = result.data.map(item => `
                    <div class="export-history-item">
                        <div class="export-file-info">
                            <div class="export-filename">${item.filename}</div>
                            <div class="export-details">
                                大小: ${item.size} | 创建时间: ${new Date(item.created).toLocaleString()}
                            </div>
                        </div>
                        <div class="export-actions">
                            <button class="btn btn-secondary" onclick="ordersManager.downloadExportFile('${item.filename}')">
                                📥 下载
                            </button>
                        </div>
                    </div>
                `).join('');
            } else {
                historyContainer.innerHTML = '<div class="loading-text">暂无导出历史</div>';
            }
        } catch (error) {
            console.error('加载导出历史失败:', error);
            const historyContainer = document.getElementById('exportHistory');
            if (historyContainer) {
                historyContainer.innerHTML = '<div class="loading-text">加载失败</div>';
            }
        }
    }

    // 下载导出文件
    async downloadExportFile(filename) {
        try {
            // 直接创建下载链接
            const link = document.createElement('a');
            link.href = `/api/export/download/${filename}`;
            link.download = filename;
            link.style.display = 'none';
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            
            this.showSuccessMessage('开始下载文件');
        } catch (error) {
            console.error('下载文件失败:', error);
            this.showError('下载文件失败: ' + error.message);
        }
    }

    // 清理旧的导出文件
    async cleanupOldExports() {
        try {
            this.showLoading(true);
            
            const response = await fetch('/api/export/cleanup', {
                method: 'DELETE',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ keepCount: 5 })
            });

            const result = await response.json();

            if (result.success) {
                this.showSuccessMessage(`已清理 ${result.data.deletedCount} 个旧文件`);
                this.loadExportHistory(); // 刷新导出历史
            } else {
                throw new Error(result.message || '清理失败');
            }
        } catch (error) {
            console.error('清理文件失败:', error);
            this.showError('清理文件失败: ' + error.message);
        } finally {
            this.showLoading(false);
        }
    }

    // 显示/隐藏高级筛选面板
    showAdvancedFilters() {
        const panel = document.getElementById('advancedFilters');
        const isVisible = panel.style.display !== 'none';
        panel.style.display = isVisible ? 'none' : 'block';
        
        // 如果首次显示，加载地区数据
        if (!isVisible) {
            this.loadRegionsForAdvancedFilter();
        }
    }

    // 为高级筛选加载地区数据
    async loadRegionsForAdvancedFilter() {
        try {
            const response = await fetch('/api/regions');
            const result = await response.json();
            
            if (result.success) {
                const select = document.getElementById('regionFilterAdvanced');
                select.innerHTML = '<option value="">全部地区</option>';
                
                result.data.forEach(region => {
                    const option = document.createElement('option');
                    option.value = region.id;
                    option.textContent = region.name;
                    select.appendChild(option);
                });
            }
        } catch (error) {
            console.error('加载地区数据失败:', error);
        }
    }

    // 应用高级筛选
    async applyAdvancedFilters() {
        try {
            // 显示筛选状态
            const statusDiv = document.getElementById('filterStatus');
            statusDiv.innerHTML = '<span class="filter-applying">🔍 正在应用筛选...</span>';
            
            // 重置页码
            this.currentPage = 1;
            
            // 重新加载数据
            await Promise.all([
                this.updateDashboard(),
                this.loadOrders(1, false)
            ]);
            
            // 显示筛选结果统计
            this.showFilterStatus();
            
        } catch (error) {
            console.error('应用筛选失败:', error);
            this.showError('应用筛选失败: ' + error.message);
        }
    }

    // 清除高级筛选
    clearAdvancedFilters() {
        // 清空所有筛选输入
        document.getElementById('globalSearchInput').value = '';
        document.getElementById('orderIdFilter').value = '';
        document.getElementById('userNameFilter').value = '';
        document.getElementById('merchantNameFilter').value = '';
        document.getElementById('statusFilter').value = '';
        document.getElementById('courseTypeFilter').value = '';
        document.getElementById('evaluationStatusFilter').value = '';
        document.getElementById('minPriceFilter').value = '';
        document.getElementById('maxPriceFilter').value = '';
        document.getElementById('orderDateFrom').value = '';
        document.getElementById('orderDateTo').value = '';
        document.getElementById('regionFilterAdvanced').value = '';
        
        // 清除筛选状态
        document.getElementById('filterStatus').innerHTML = '';
        
        // 重新加载数据
        this.applyAdvancedFilters();
    }

    // 显示筛选状态
    showFilterStatus() {
        const filters = this.getCurrentFilters();
        const activeFilters = [];
        
        if (filters.search) activeFilters.push(`搜索: ${filters.search}`);
        if (filters.orderId) activeFilters.push(`订单号: ${filters.orderId}`);
        if (filters.userName) activeFilters.push(`用户: ${filters.userName}`);
        if (filters.merchantName) activeFilters.push(`商家: ${filters.merchantName}`);
        if (filters.status) activeFilters.push(`状态: ${this.getStatusText(filters.status)}`);
        if (filters.courseType) activeFilters.push(`课程: ${filters.courseType}`);
        if (filters.evaluationStatus) activeFilters.push(`评价: ${this.getEvaluationStatusText(filters.evaluationStatus)}`);
        if (filters.minPrice || filters.maxPrice) {
            const priceRange = `${filters.minPrice || 0} - ${filters.maxPrice || '∞'}`;
            activeFilters.push(`价格: ¥${priceRange}`);
        }
        if (filters.dateFrom || filters.dateTo) {
            const dateRange = `${filters.dateFrom || '开始'} ~ ${filters.dateTo || '现在'}`;
            activeFilters.push(`时间: ${dateRange}`);
        }
        
        const statusDiv = document.getElementById('filterStatus');
        if (activeFilters.length > 0) {
            statusDiv.innerHTML = `
                <div class="filter-active">
                    <span class="filter-count">✅ 已应用 ${activeFilters.length} 个筛选条件</span>
                    <div class="filter-list">${activeFilters.join(' | ')}</div>
                </div>
            `;
        } else {
            statusDiv.innerHTML = '<span class="filter-none">📋 未应用筛选条件</span>';
        }
    }

    // 获取评价状态文本
    getEvaluationStatusText(status) {
        const statusMap = {
            'user_completed': '用户已评价',
            'user_pending': '用户未评价',
            'merchant_completed': '商家已评价',
            'merchant_pending': '商家未评价',
            'all_completed': '双方已评价',
            'none_completed': '双方未评价'
        };
        return statusMap[status] || status;
    }

    // 刷新订单数据（仅订单列表）
    async refreshOrdersData() {
        console.log('正在刷新订单数据...');
        this.clearCache('orders');
        this.clearCache('stats');
        await this.loadOrders(1, false);
        await this.updateDashboard();
        this.showSuccessMessage('订单数据已刷新');
    }

    // 显示手动播报对话框
    showManualBroadcastDialog(orderId) {
        try {
            const modal = document.createElement('div');
            modal.className = 'broadcast-dialog-modal';
            modal.id = 'broadcastDialogModal';
            
            modal.innerHTML = `
                <div class="modal-overlay"></div>
                <div class="modal-container" style="max-width: 500px;">
                    <div class="modal-header">
                        <h3 class="modal-title">
                            <span class="order-icon">📢</span>
                            手动播报订单 #${orderId}
                        </h3>
                        <button class="modal-close" onclick="this.closest('.broadcast-dialog-modal').remove()">
                            ×
                        </button>
                    </div>
                    
                    <div class="broadcast-dialog-content" style="padding: 1.5rem;">
                        <div class="form-group">
                            <label>播报类型：</label>
                            <div class="radio-group" style="margin-top: 0.5rem;">
                                <label style="display: flex; align-items: center; margin-bottom: 0.5rem;">
                                    <input type="radio" name="broadcastType" value="real" checked style="margin-right: 0.5rem;">
                                    实名播报（显示用户名）
                                </label>
                                <label style="display: flex; align-items: center;">
                                    <input type="radio" name="broadcastType" value="anonymous" style="margin-right: 0.5rem;">
                                    匿名播报（隐藏用户名）
                                </label>
                            </div>
                        </div>
                        
                        <div class="form-group" style="margin-top: 1rem;">
                            <label>自定义播报消息（可选）：</label>
                            <textarea id="customBroadcastMessage" rows="4" placeholder="留空则使用默认播报格式" 
                                style="width: 100%; margin-top: 0.5rem; padding: 0.5rem; border: 1px solid #ddd; border-radius: 4px;"></textarea>
                        </div>
                        
                        <div class="broadcast-dialog-actions" style="margin-top: 1.5rem; display: flex; gap: 1rem; justify-content: flex-end;">
                            <button class="btn btn-secondary" onclick="this.closest('.broadcast-dialog-modal').remove()">
                                取消
                            </button>
                            <button class="btn btn-primary" onclick="ordersManager.executeManualBroadcast('${orderId}')">
                                📢 立即播报
                            </button>
                        </div>
                    </div>
                </div>
            `;

            // 移除现有对话框
            const existingModal = document.getElementById('broadcastDialogModal');
            if (existingModal) {
                existingModal.remove();
            }

            // 添加到页面
            document.body.appendChild(modal);

            // 点击背景关闭
            modal.querySelector('.modal-overlay').addEventListener('click', (e) => {
                if (e.target.classList.contains('modal-overlay')) {
                    modal.remove();
                }
            });

        } catch (error) {
            console.error('显示播报对话框失败:', error);
            this.showError('显示播报对话框失败: ' + error.message);
        }
    }

    // 执行手动播报
    async executeManualBroadcast(orderId) {
        try {
            const modal = document.getElementById('broadcastDialogModal');
            if (!modal) return;

            // 获取播报类型
            const broadcastTypeRadios = modal.querySelectorAll('input[name="broadcastType"]');
            let broadcastType = 'real';
            for (const radio of broadcastTypeRadios) {
                if (radio.checked) {
                    broadcastType = radio.value;
                    break;
                }
            }

            // 获取自定义消息
            const customMessage = modal.querySelector('#customBroadcastMessage').value.trim();

            console.log(`执行手动播报 - 订单ID: ${orderId}, 类型: ${broadcastType}, 自定义消息: ${customMessage}`);

            // 显示加载状态
            const executeButton = modal.querySelector('.btn-primary');
            const originalText = executeButton.textContent;
            executeButton.textContent = '播报中...';
            executeButton.disabled = true;

            // 发送播报请求
            const response = await fetch('/api/manual-broadcast', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    orderId: orderId,
                    broadcastType: broadcastType,
                    customMessage: customMessage
                })
            });

            const result = await response.json();

            if (result.success) {
                this.showSuccessMessage('播报成功！消息已发送到群组');
                modal.remove();
            } else {
                throw new Error(result.error || result.message || '播报失败');
            }

        } catch (error) {
            console.error('执行播报失败:', error);
            this.showError('播报失败: ' + error.message);
            
            // 恢复按钮状态
            const modal = document.getElementById('broadcastDialogModal');
            if (modal) {
                const executeButton = modal.querySelector('.btn-primary');
                if (executeButton) {
                    executeButton.textContent = '📢 立即播报';
                    executeButton.disabled = false;
                }
            }
        }
    }
}

// 初始化管理器
const ordersManager = new OptimizedOrdersManager();

// 设置全局访问
window.ordersManager = ordersManager;

// 全局方法（保持向后兼容）
window.refreshData = () => ordersManager.refreshData();
window.refreshAllData = () => ordersManager.refreshAllData();
window.searchOrders = (query) => ordersManager.searchOrders(query);
window.changePage = (direction) => ordersManager.changePage(direction);
window.updateDashboard = () => ordersManager.updateDashboard();
window.showExportModal = () => ordersManager.showExportModal();
window.closeExportModal = () => ordersManager.closeExportModal();
window.startDataExport = () => ordersManager.startDataExport();
window.cleanupOldExports = () => ordersManager.cleanupOldExports();

// 新增的高级筛选功能
window.showAdvancedFilters = () => ordersManager.showAdvancedFilters();
window.applyAdvancedFilters = () => ordersManager.applyAdvancedFilters();
window.clearAdvancedFilters = () => ordersManager.clearAdvancedFilters();
window.refreshOrdersData = () => ordersManager.refreshOrdersData();

console.log('订单管理系统优化版本已加载，全局访问已设置'); 