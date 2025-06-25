const TelegramBot = require('node-telegram-bot-api');
const dbOperations = require('../models/dbOperations');
const evaluationService = require('./evaluationService');

// 环境变量
const BOT_TOKEN = process.env.BOT_TOKEN;

// 初始化Telegram Bot
let bot;
try {
    // 配置Bot选项，避免IP连接问题
    const botOptions = { 
        polling: true,
        // 添加请求选项来提高连接稳定性
        request: {
            // 增加超时时间
            timeout: 60000,
            // 启用keep-alive
            forever: true,
            // 允许重试
            pool: {
                maxSockets: 10
            }
        }
    };
    
    bot = new TelegramBot(BOT_TOKEN, botOptions);
    console.log('✅ Telegram Bot初始化成功');
    
    // 添加错误事件监听
    bot.on('error', (error) => {
        console.error('❌ Telegram Bot错误:', error.message);
        if (error.code === 'EFATAL') {
            console.log('⚠️ 检测到致命错误，但Bot将继续运行');
        }
    });
    
    bot.on('polling_error', (error) => {
        console.error('❌ Telegram Bot轮询错误:', error.message);
        if (error.message.includes('ENOTFOUND')) {
            console.log('⚠️ 网络连接问题，Bot将自动重试连接');
        } else if (error.message.includes('ETIMEDOUT')) {
            console.log('⚠️ 连接超时，Bot将自动重试连接');
        }
    });
    
} catch (error) {
    console.log('⚠️ Telegram Bot初始化失败，但应用将继续运行:', error.message);
    // 创建一个假的bot对象，避免后续代码报错
    bot = {
        on: () => {},
        sendMessage: () => Promise.reject(new Error('Bot未初始化')),
        sendPhoto: () => Promise.reject(new Error('Bot未初始化')),
        answerCallbackQuery: () => Promise.reject(new Error('Bot未初始化'))
    };
}

// 全局变量 - 优化内存管理
let merchants = [];
let buttons = [];
let messageTemplates = [];
let triggerWords = [];
let scheduledTasks = [];
let bindCodes = [];
let regions = [];

// 快速查找索引
let merchantsMap = new Map();
let regionsMap = new Map();

// 播报倒计时管理器
const broadcastTimers = new Map(); // 存储用户的播报倒计时

// 内存映射管理 - 添加自动清理机制
// 用户绑定状态变量已移除（绑定流程已简化）
const userMessageHistory = new Map(); // 用户消息历史记录
const triggerCooldowns = new Map(); // 触发词冷却时间
const bookingCooldowns = new Map(); // 预约冷却时间管理

// 内存管理配置
const MEMORY_CLEANUP_INTERVAL = 30 * 60 * 1000; // 30分钟清理一次
const MAX_USER_HISTORY = 20; // 每用户最多保存20条消息历史

// 定期清理过期的内存数据
setInterval(() => {
    const now = Date.now();
    
    // 清理过期的触发词冷却
    for (const [cooldownKey, cooldownTime] of triggerCooldowns.entries()) {
        if (now - cooldownTime > 5 * 60 * 1000) { // 5分钟过期
            triggerCooldowns.delete(cooldownKey);
        }
    }
    
    // 清理过期的预约冷却（30分钟过期）
    for (const [cooldownKey, cooldownTime] of bookingCooldowns.entries()) {
        if (now - cooldownTime > 30 * 60 * 1000) { // 30分钟过期
            bookingCooldowns.delete(cooldownKey);
        }
    }
    
    // 清理过期的消息历史（保留最近的消息）
    for (const [userId, history] of userMessageHistory.entries()) {
        if (history.length > MAX_USER_HISTORY) {
            history.splice(0, history.length - MAX_USER_HISTORY);
        }
    }
    
    console.log(`内存清理完成 - 消息历史大小: ${userMessageHistory.size}, 预约冷却大小: ${bookingCooldowns.size}`);
}, MEMORY_CLEANUP_INTERVAL);

// 绑定步骤枚举已移除（绑定流程已简化）

// 消息历史管理
function addMessageToHistory(userId, messageId, messageType, data = {}) {
    if (!userMessageHistory.has(userId)) {
        userMessageHistory.set(userId, []);
    }
    
    const history = userMessageHistory.get(userId);
    history.push({
        messageId,
        messageType,
        data,
        timestamp: Date.now()
    });
    
    // 保持最近20条消息记录
    if (history.length > 20) {
        history.shift();
    }
}

function getLastMessage(userId) {
    const history = userMessageHistory.get(userId);
    return history && history.length > 0 ? history[history.length - 1] : null;
}

function getPreviousMessage(userId) {
    const history = userMessageHistory.get(userId);
    return history && history.length > 1 ? history[history.length - 2] : null;
}

// 清空用户对话历史
async function clearUserConversation(userId) {
    try {
        const history = userMessageHistory.get(userId);
        if (history && history.length > 0) {
            // 删除所有历史消息
            for (const message of history) {
                try {
                    await bot.deleteMessage(userId, message.messageId);
                } catch (error) {
                    console.log(`无法删除消息 ${message.messageId}: ${error.message}`);
                }
            }
            // 清空历史记录
            userMessageHistory.set(userId, []);
        }
    } catch (error) {
        console.error('清空用户对话历史失败:', error);
    }
}

// 删除上一条消息并发送新消息的丝滑版本
async function sendMessageWithDelete(chatId, text, options = {}, messageType = 'general', data = {}) {
    try {
        // 获取用户的最后一条消息
        const lastMessage = getLastMessage(chatId);
        
        // 发送新消息
        const sentMessage = await bot.sendMessage(chatId, text, options);
        
        // 记录新消息
        addMessageToHistory(chatId, sentMessage.message_id, messageType, data);
        
        // 安全删除上一条消息（延迟200ms确保新消息已发送）
        if (lastMessage && lastMessage.messageId) {
            setTimeout(async () => {
                try {
                    await bot.deleteMessage(chatId, lastMessage.messageId);
                    console.log(`✅ 消息删除成功: ${chatId}_${lastMessage.messageId}`);
                } catch (error) {
                    // 只有在不是"消息不存在"错误时才记录
                    if (!error.message.includes('message to delete not found')) {
                        console.log(`⚠️ 消息删除失败: ${chatId}_${lastMessage.messageId} - ${error.message}`);
                    }
                }
            }, 200);
        }
        
        return sentMessage;
        
    } catch (error) {
        console.error('发送消息失败:', error);
        throw error;
    }
}

// 立即删除当前消息并发送新消息的丝滑版本
async function sendMessageWithImmediateDelete(chatId, text, options = {}, messageType = 'general', data = {}) {
    try {
        // 获取用户的最后一条消息
        const lastMessage = getLastMessage(chatId);
        
        // 立即删除上一条消息（提升用户体验）
        if (lastMessage && lastMessage.messageId) {
            try {
                await bot.deleteMessage(chatId, lastMessage.messageId);
                console.log(`✅ 消息立即删除成功: ${chatId}_${lastMessage.messageId}`);
            } catch (error) {
                if (!error.message.includes('message to delete not found')) {
                    console.log(`⚠️ 消息立即删除失败: ${chatId}_${lastMessage.messageId} - ${error.message}`);
                }
            }
        }
        
        // 发送新消息
        const sentMessage = await bot.sendMessage(chatId, text, options);
        
        // 记录新消息
        addMessageToHistory(chatId, sentMessage.message_id, messageType, data);
        
        return sentMessage;
        
    } catch (error) {
        console.error('发送消息失败:', error);
        throw error;
    }
}

// 发送消息但不删除历史（用于需要保留的重要信息）
async function sendMessageWithoutDelete(chatId, text, options = {}, messageType = 'general', data = {}) {
    try {
        // 发送新消息
        const sentMessage = await bot.sendMessage(chatId, text, options);
        
        // 记录新消息
        addMessageToHistory(chatId, sentMessage.message_id, messageType, data);
        
        return sentMessage;
        
    } catch (error) {
        console.error('发送消息失败:', error);
        throw error;
    }
}

// 处理返回按钮
async function handleBackButton(userId, messageType, data = {}) {
    try {
        switch (messageType) {
            case 'course_completion_check':
                // 返回到联系老师页面
                const bookingSession = dbOperations.getBookingSession(data.bookingSessionId);
                if (bookingSession) {
                    const merchant = dbOperations.getMerchantById(bookingSession.merchant_id);
                    if (merchant) {
                        let contactLink = merchant.contact;
                        if (contactLink && contactLink.startsWith('@')) {
                            contactLink = `[${contactLink}](https://t.me/${contactLink.substring(1)})`;
                        }
                        
                        const message = `🐤小鸡出征！
已将出击信息发送给${contactLink}老师。请点击联系方式开始私聊老师进行预约。`;
                        
                        await sendMessageWithDelete(userId, message, { parse_mode: 'Markdown' }, 'contact_teacher', data);
                    }
                }
                break;
                
            case 'user_evaluation':
                // 返回到课程完成确认（只给当前用户发送，避免重复）
                // 获取老师联系方式
                const userEvalBookingSession = dbOperations.getBookingSession(data.bookingSessionId);
                let userEvalTeacherContact = data.teacherName; // 默认使用艺名
                
                if (userEvalBookingSession) {
                    const userEvalMerchant = dbOperations.getMerchantById(userEvalBookingSession.merchant_id);
                    if (userEvalMerchant && userEvalMerchant.contact) {
                        // 确保联系方式有@符号
                        userEvalTeacherContact = userEvalMerchant.contact.startsWith('@') ? userEvalMerchant.contact : `@${userEvalMerchant.contact}`;
                    }
                }
                
                const userMessage = `是否完成该老师（${data.teacherName} ${userEvalTeacherContact}）的课程？`;
                const userKeyboard = {
                    inline_keyboard: [
                        [
                            { text: '已完成', callback_data: `course_completed_${data.bookingSessionId}` },
                            { text: '未完成', callback_data: `course_incomplete_${data.bookingSessionId}` }
                        ]
                    ]
                };
                await sendMessageWithDelete(userId, userMessage, { reply_markup: userKeyboard }, 'course_completion_check', data);
                break;
                
            case 'merchant_evaluation':
                // 返回到课程完成确认（只给当前商家发送，避免重复）
                const merchantMessage = `是否完成该用户（${data.userFullName}）的课程？`;
                const merchantKeyboard = {
                    inline_keyboard: [
                        [
                            { text: '已完成', callback_data: `course_completed_${data.bookingSessionId}` },
                            { text: '未完成', callback_data: `course_incomplete_${data.bookingSessionId}` }
                        ]
                    ]
                };
                await sendMessageWithDelete(userId, merchantMessage, { reply_markup: merchantKeyboard }, 'course_completion_check', data);
                break;
                
            case 'rebook_question':
                // 返回到课程未完成消息
                await sendMessageWithDelete(userId, '课程未完成，是否重新预约？', {}, 'course_incomplete');
                break;
                
            default:
                await sendMessageWithDelete(userId, '已返回上一步', {}, 'back_result');
                break;
        }
        
    } catch (error) {
        console.error('处理返回按钮失败:', error);
    }
}

// 优化的缓存加载函数
async function loadCacheData() {
    const startTime = Date.now();
    
    try {
        // 使用Promise.allSettled确保即使部分加载失败也能继续
        const results = await Promise.allSettled([
            Promise.resolve(dbOperations.getAllMerchants()),
            Promise.resolve(dbOperations.getButtons()),
            Promise.resolve(dbOperations.getMessageTemplates()),
            Promise.resolve(dbOperations.getTriggerWords()),
            Promise.resolve(dbOperations.getScheduledTasks()),
            Promise.resolve(dbOperations.getAllBindCodes()),
            Promise.resolve(dbOperations.getAllRegions())
        ]);
        
        // 处理加载结果
        merchants = results[0].status === 'fulfilled' ? results[0].value || [] : [];
        buttons = results[1].status === 'fulfilled' ? results[1].value || [] : [];
        messageTemplates = results[2].status === 'fulfilled' ? results[2].value || [] : [];
        triggerWords = results[3].status === 'fulfilled' ? results[3].value || [] : [];
        scheduledTasks = results[4].status === 'fulfilled' ? results[4].value || [] : [];
        bindCodes = results[5].status === 'fulfilled' ? results[5].value || [] : [];
        regions = results[6].status === 'fulfilled' ? results[6].value || [] : [];
        
        // 统计失败的加载操作
        const failedLoads = results.filter(r => r.status === 'rejected');
        if (failedLoads.length > 0) {
            console.warn(`⚠️ ${failedLoads.length} 个缓存加载失败:`, failedLoads.map(r => r.reason));
        }
        
        const loadTime = Date.now() - startTime;
        console.log(`✅ 缓存数据加载完成 (${loadTime}ms) - 商家: ${merchants.length}, 按钮: ${buttons.length}, 模板: ${messageTemplates.length}, 触发词: ${triggerWords.length}, 任务: ${scheduledTasks.length}, 绑定码: ${bindCodes.length}, 地区: ${regions.length}`);
        
        // 建立快速查找索引
        merchantsMap = new Map(merchants.map(m => [m.id, m]));
        regionsMap = new Map(regions.map(r => [r.id, r]));
        
    } catch (error) {
        console.error('❌ 缓存数据加载失败:', error);
        // 确保所有变量都有默认值
        merchants = merchants || [];
        buttons = buttons || [];
        messageTemplates = messageTemplates || [];
        triggerWords = triggerWords || [];
        scheduledTasks = scheduledTasks || [];
        bindCodes = bindCodes || [];
        regions = regions || [];
        merchantsMap = merchantsMap || new Map();
        regionsMap = regionsMap || new Map();
    }
}

// 发送消息模板
async function sendMessageTemplate(chatId, template, replyToMessageId = null) {
    try {
        const options = {
            parse_mode: 'HTML'
        };

        if (replyToMessageId) {
            options.reply_to_message_id = replyToMessageId;
        }

        // 解析按钮配置
        if (template.buttons_config) {
            const buttonsConfig = JSON.parse(template.buttons_config);
            if (buttonsConfig && buttonsConfig.length > 0) {
                const keyboard = buttonsConfig.map(row => 
                    row.map(btn => ({
                        text: btn.text,
                        callback_data: btn.callback_data || `template_${template.id}_${btn.text}`
                    }))
                );
                options.reply_markup = { inline_keyboard: keyboard };
            }
        }

        // 发送消息
        if (template.image_url) {
            // 如果是base64图片数据，转换为Buffer
            let photoData = template.image_url;
            if (typeof photoData === 'string' && photoData.startsWith('data:image/')) {
                // 从base64 data URL中提取数据
                const base64Data = photoData.split(',')[1];
                photoData = Buffer.from(base64Data, 'base64');
            }
            
            await bot.sendPhoto(chatId, photoData, {
                caption: template.content,
                parse_mode: 'HTML',
                show_caption_above_media: true,
                ...options
            });
        } else {
            await bot.sendMessage(chatId, template.content, options);
        }

        return true;
    } catch (error) {
        console.error('发送消息模板失败:', error);
        return false;
    }
}

// 触发词检测 - 优化版本 [暂时关闭]
function checkTriggerWords(message, chatId) {
    // 🚫 关键词监控功能已暂时关闭
    // 如需启用，请取消下面代码的注释
    
    /*
    const text = message.text?.toLowerCase() || '';
    if (!text) return;
    
    // 预过滤：只获取当前聊天的活跃触发词
    const chatTriggers = triggerWords.filter(tw => tw.chat_id == chatId && tw.active);
    if (chatTriggers.length === 0) return;

    for (const trigger of chatTriggers) {
        let isMatch = false;
        const triggerWord = trigger.word.toLowerCase();
        
        // 性能优化：使用更高效的匹配算法
        if (trigger.match_type === 'exact') {
            isMatch = text === triggerWord;
        } else if (trigger.match_type === 'contains') {
            isMatch = text.includes(triggerWord);
        }

        if (isMatch) {
            // 检查防刷屏机制
            const cooldownKey = `${chatId}_${trigger.id}`;
            const lastTriggered = triggerCooldowns.get(cooldownKey) || 0;
            const now = Date.now();
            
            if (now - lastTriggered < 5 * 60 * 1000) { // 5分钟冷却
                continue;
            }

            triggerCooldowns.set(cooldownKey, now);
            
            // 异步处理触发，使用更高效的方式
            setImmediate(async () => {
                try {
                    // 使用缓存的模板查找，避免每次都遍历
                    const template = messageTemplates.find(t => t.id === trigger.template_id);
                    if (!template) {
                        console.error(`模板 ${trigger.template_id} 不存在`);
                        return;
                    }
                    
                    // 并行执行非阻塞操作
                    const [sendResult, , ] = await Promise.allSettled([
                        sendMessageTemplate(chatId, template, message.message_id),
                        Promise.resolve(dbOperations.incrementTriggerCount(trigger.id)),
                        Promise.resolve(dbOperations.logInteraction(
                            message.from.id,
                            message.from.username,
                            message.from.first_name,
                            message.from.last_name,
                            null,
                            template.id,
                            'trigger',
                            chatId
                        ))
                    ]);
                    
                    if (sendResult.status === 'fulfilled') {
                        console.log(`触发词 "${trigger.word}" 在群组 ${chatId} 被触发`);
                    } else {
                        console.error(`触发词 "${trigger.word}" 处理失败:`, sendResult.reason);
                    }
                    
                } catch (error) {
                    console.error('处理触发词失败:', error);
                }
            });

            break; // 只触发第一个匹配的触发词
        }
    }
    */
}

// 处理文字输入（评价系统和触发词检查）
async function handleTextInput(userId, chatId, text, username) {
    // 检查是否在用户文字评价状态（新系统：检查内存状态，旧系统：检查数据库会话）
    let isUserTextComment = false;
    let userEvalSession = null;
    
    // 检查新系统：内存状态中是否刚完成12项评价且正在等待文字输入
    const userEvalState = userEvaluationStates.get(userId);
    if (userEvalState && userEvalState.completedCount === 12 && chatId > 0) {
        // 用户已完成12项评价，任何文本输入都认为是文字评价
        console.log(`检测到新系统用户文字评价输入`);
        isUserTextComment = true;
    }
    
    // 检查旧系统：数据库会话状态
    if (!isUserTextComment) {
        userEvalSession = dbOperations.getEvaluationSessionByUserAndState(userId, 'user_text_comment');
        if (userEvalSession && chatId > 0) {
            console.log(`检测到旧系统用户文字评价输入`);
            isUserTextComment = true;
        }
    }
    
    if (isUserTextComment) {
        // 处理用户文字评价输入
        await handleUserTextCommentInput(userId, text, userEvalSession);
        return;
    }
    
    // 检查是否在商家详细评价文字输入状态
    const merchantEvalSession = dbOperations.getEvaluationSessionByUserAndState(userId, 'merchant_detail_comment');
    if (merchantEvalSession && chatId > 0) { // 只处理私聊消息
        // 处理商家详细评价文字输入
        await handleMerchantDetailCommentInput(userId, text, merchantEvalSession);
        return;
    }
    
    // 检查触发词（仅群组消息）[暂时关闭]
    // 🚫 关键词监控功能已暂时关闭
    /*
    if (chatId < 0) { // 群组消息
        console.log(`群组消息 - chatId: ${chatId}, userId: ${userId}, text: "${text}"`);
        console.log(`当前触发词数量: ${triggerWords.length}, 模板数量: ${messageTemplates.length}`);
        checkTriggerWords({ 
            text, 
            from: { id: userId, username }, 
            chat: { id: chatId },
            message_id: Date.now() // 添加消息ID
        }, chatId);
    }
    */
}

// 旧的绑定流程函数已移除（绑定流程已简化）

// 初始化Bot事件监听
function initBotHandlers() {
    // Bot消息处理
    bot.on('message', async (msg) => {
        const chatId = msg.chat.id;
        const userId = msg.from.id;
        const text = msg.text;
        const username = msg.from.username;

        // 处理 /start 命令
        if (text && text.startsWith('/start')) {
            console.log(`收到/start命令: ${text}`);
            
            // 记录用户交互
            dbOperations.logInteraction(
                userId,
                username,
                msg.from.first_name,
                msg.from.last_name,
                null,
                null,
                'start',
                chatId
            );
            

            
            // 检查是否是商家联系流程
            if (text.includes(' merchant_')) {
                const merchantId = text.split('merchant_')[1];
                console.log(`解析到商家ID: ${merchantId}`);
                
                const merchant = dbOperations.getMerchantById(merchantId);
                console.log(`查询到商家信息:`, merchant);
                
                if (merchant) {
                    // 检查商家状态
                    if (merchant.status !== 'active') {
                        bot.sendMessage(chatId, '😔 抱歉，目前老师已下线，请看看其他老师吧～\n\n您可以使用 /start 命令重新查看可用的老师列表。');
                        return;
                    }
                    // 发送商家信息（不包含联系方式，用户需要通过预约按钮才能看到联系方式）
                    const merchantInfo = `地区：#${merchant.region_name || 'xx'}              艺名：${merchant.teacher_name || '未填写'}\n` +
                                       `优点：${merchant.advantages || '未填写'}\n` +
                                       `缺点：${merchant.disadvantages || '未填写'}\n` +
                                       `价格：${merchant.price1 || '未填写'}p              ${merchant.price2 || '未填写'}pp\n\n` +
                                       `老师💃自填基本功：\n` +
                                                   dbOperations.formatMerchantSkillsDisplay(merchant.id);
                    
                    // 构建按钮 - 三个标准按钮
                    const buttons = [
                        [{ text: '预约老师课程', callback_data: `attack_${merchantId}` }]
                    ];
                    
                    // 如果商家有频道链接，添加"关注老师频道"按钮
                    if (merchant.channel_link && merchant.channel_link.trim()) {
                        buttons.push([{ text: '关注老师频道', callback_data: `channel_${merchantId}` }]);
                    }
                    
                    // 添加返回榜单按钮
                    buttons.push([{ text: '返回榜单', url: 'https://t.me/xiaoji233' }]);
                    
                    const options = {
                        reply_markup: {
                            inline_keyboard: buttons
                        }
                    };
                    
                    console.log(`发送商家信息给用户 ${userId}`);
                    
                    // 如果商家有图片，发送图片消息；否则发送文字消息
                    let sentMessage;
                    if (merchant.image_url && merchant.image_url.trim()) {
                        // 如果是base64图片数据，转换为Buffer
                        let photoData = merchant.image_url;
                        if (typeof photoData === 'string' && photoData.startsWith('data:image/')) {
                            // 从base64 data URL中提取数据
                            const base64Data = photoData.split(',')[1];
                            photoData = Buffer.from(base64Data, 'base64');
                        }
                        
                        sentMessage = await bot.sendPhoto(chatId, photoData, {
                            caption: merchantInfo,
                            parse_mode: 'HTML',
                            show_caption_above_media: true,
                            reply_markup: options.reply_markup
                        });
                    } else {
                        sentMessage = await bot.sendMessage(chatId, merchantInfo, options);
                    }
                    
                    console.log(`发送商家信息成功id${sentMessage.message_id}`);
                    
                    // 将商家信息消息添加到消息跟踪系统
                    addMessageToHistory(userId, sentMessage.message_id, 'merchant_info', {
                        merchantId: merchantId,
                        merchantName: merchant.teacher_name
                    });
                    return;
                } else {
                    console.log(`未找到商家ID ${merchantId} 对应的商家信息`);
                }
            }
            
            console.log(`发送默认欢迎消息给用户 ${userId}`);
            bot.sendMessage(chatId, '各位小鸡勇士，欢迎来到🐥小鸡管家\n关注机器人并置顶！\n避免后续要出击时找不到哦～');
            return;
        }

        // 处理 /bind 命令
        if (text && text.startsWith('/bind ')) {
            const code = text.replace('/bind ', '').trim().toUpperCase();
            
            // 检查用户是否已绑定
            const existingMerchant = dbOperations.getMerchantByUserId(userId);
            if (existingMerchant) {
                bot.sendMessage(chatId, '❌ 您已经绑定过账户了！');
                return;
            }
            
            // 验证绑定码 - 使用统一的验证逻辑
            const bindCode = dbOperations.getBindCode(code);
            if (!bindCode) {
                bot.sendMessage(chatId, '❌ 绑定码不存在');
                return;
            }
            if (bindCode.used) {
                bot.sendMessage(chatId, '❌ 绑定码已被使用');
                return;
            }
            
            try {
                // 检查是否已有使用此绑定码的商家记录（管理员创建的）
                const { db } = require('../config/database');
                const existingMerchantWithCode = db.prepare('SELECT * FROM merchants WHERE bind_code = ?').get(code);
                
                let merchantId;
                
                if (existingMerchantWithCode) {
                    // 如果已有商家记录，更新其user_id和username
                    console.log(`找到现有商家记录 ID: ${existingMerchantWithCode.id}，更新绑定信息`);
                    
                    const updateStmt = db.prepare(`
                        UPDATE merchants 
                        SET user_id = ?, username = ?, bind_step = 5, status = 'active'
                        WHERE id = ?
                    `);
                    updateStmt.run(userId, username, existingMerchantWithCode.id);
                    
                    merchantId = existingMerchantWithCode.id;
                    console.log(`更新现有商家记录成功: ${existingMerchantWithCode.teacher_name} -> 用户 ${userId} (${username})`);
                } else {
                    // 如果没有现有记录，创建新的商家记录
                    console.log(`未找到现有商家记录，创建新的商家记录`);
                    const merchantName = username || `用户${userId}`;
                    merchantId = dbOperations.createMerchantSimple({
                        user_id: userId,
                        username: username,
                        bind_code: code,
                        bind_step: 5,  // 直接设为完成状态
                        status: 'active'
                    });
                }
                
                // 标记绑定码为已使用
                dbOperations.useBindCode(code, userId);
                
                // 重新加载缓存数据
                await loadCacheData();
                
                // 发送绑定成功消息（分两条发送）
                const successMessage1 = `🎉 欢迎加入小鸡榜单！
✅ 您已绑定成功！
⏳ 接下来您只需要等待咨询即可。`;
                
                const successMessage2 = `📌 请置顶🐥小鸡管家机器人
⚠️ 避免错过小鸡的客人通知哦～
❓ 如有问题请从群内联系客服 @xiaoji57`;
                
                bot.sendMessage(chatId, successMessage1);
                setTimeout(() => {
                    bot.sendMessage(chatId, successMessage2);
                }, 500); // 延迟500毫秒发送第二条消息
                
                console.log(`商家 ${userId} (${username}) 绑定成功，绑定码: ${code}, 商家ID: ${merchantId}`);
                
            } catch (error) {
                console.error('绑定过程中出错:', error);
                bot.sendMessage(chatId, '❌ 绑定过程中出现错误，请重试或联系管理员');
            }
            
            return;
        }

        // 处理 /help 命令
        if (text === '/help') {
            bot.sendMessage(chatId, '📖 使用说明：\n\n/start - 开始使用\n/bind <绑定码> - 商家绑定账户\n/help - 查看帮助');
            return;
        }

        // 处理文字输入（评价系统和触发词检查）
        await handleTextInput(userId, chatId, text, username);
    });

    // 高效防重复点击机制 - 基于操作去重
    const userLastActions = new Map(); // 存储用户最近的操作：userId_actionType -> timestamp
    
    // 定期清理过期操作记录（5分钟清理一次，清理超过30秒的记录）
    setInterval(() => {
        const now = Date.now();
        for (const [key, timestamp] of userLastActions.entries()) {
            if (now - timestamp > 30000) { // 30秒过期
                userLastActions.delete(key);
            }
        }
    }, 5 * 60 * 1000);
    
    // 提取操作类型的函数 - 用于防重复处理
    function extractActionType(data) {
        // 提取操作的核心类型，忽略具体参数
        if (data.startsWith('attack_')) return 'attack';
        if (data.startsWith('book_')) return `book_${data.split('_')[1]}`; // book_p, book_pp, book_other
        if (data.startsWith('course_completed_')) return 'course_completed';
        if (data.startsWith('course_incomplete_')) return 'course_incomplete';
        if (data.startsWith('eval_score_')) return 'eval_score';
        if (data.startsWith('eval_info_')) return 'eval_info';
        if (data === 'eval_incomplete') return 'eval_ui_click';
        if (data.startsWith('eval_submit_')) return 'eval_submit';
        if (data.startsWith('user_eval_') && data.includes('_confirm_')) return 'user_eval_confirm';
        if (data.startsWith('broadcast_')) return `broadcast_${data.split('_')[1]}`; // broadcast_real, broadcast_anon, broadcast_no
        if (data.startsWith('detail_') && data.includes('_confirm_')) return 'detail_confirm';
        
        // 特殊处理商家详细评价，让每个步骤有独立的动作类型
        if (data.startsWith('merchant_detail_eval_')) {
            const parts = data.split('_');
            if (parts.length >= 4) {
                return `merchant_detail_eval_${parts[3]}`; // 根据评价类型区分
            }
        }
        
        // 对于其他操作，使用前缀作为类型
        const prefix = data.split('_')[0];
        return prefix || data;
    }
    
    // 处理按钮点击 - 高效防重复机制
    bot.on('callback_query', async (query) => {
        const chatId = query.message.chat.id;
        const userId = query.from.id;
        const data = query.data;
        const queryId = query.id;
        
        try {
            // 1. 立即响应callback query（必须 - 确保Loading立即消失）
            await bot.answerCallbackQuery(queryId);
            
            // 2. 根据callback类型决定是否删除消息
            const isEvaluationClick = data.startsWith('eval_score_') || 
                                    data.startsWith('eval_info_') || 
                                    data === 'eval_incomplete' ||
                                    data.startsWith('eval_submit_');
            
            if (!isEvaluationClick) {
                // 非评价系统的按钮点击才删除消息
                try {
                    await bot.deleteMessage(chatId, query.message.message_id);
                    console.log(`✅ 立即删除按钮消息成功: ${chatId}_${query.message.message_id}`);
                    
                    // 从消息跟踪系统中移除已删除的消息
                    const history = userMessageHistory.get(userId);
                    if (history) {
                        const updatedHistory = history.filter(msg => msg.messageId !== query.message.message_id);
                        userMessageHistory.set(userId, updatedHistory);
                    }
                } catch (error) {
                    if (!error.message.includes('message to delete not found')) {
                        console.log(`⚠️ 立即删除按钮消息失败: ${chatId}_${query.message.message_id} - ${error.message}`);
                    }
                }
            }
            
            // 3. 将所有业务逻辑移到异步处理（不阻塞callback响应）
            setImmediate(async () => {
                try {
                    // 评价系统完全跳过防重复检查，直接处理
                    if (isEvaluationClick) {
                        await handleAsyncCallbackLogic(chatId, userId, data, query);
                        return;
                    }
                    
                    // 非评价系统才进行防重复处理
                    const actionType = extractActionType(data);
                    const actionKey = `${userId}_${actionType}`;
                    const now = Date.now();
                    const lastActionTime = userLastActions.get(actionKey) || 0;
                    
                    // 检查是否为重复操作（3秒内的相同操作视为重复）
                    if (now - lastActionTime < 3000) {
                        console.log(`🛡️ 后台拦截重复操作: ${actionKey} (${data})`);
                        return; // 静默拦截，用户端已经得到响应且消息已删除
                    }
                    
                    // 记录本次操作
                    userLastActions.set(actionKey, now);
                    
                    // 异步处理业务逻辑
                    await handleAsyncCallbackLogic(chatId, userId, data, query);
                    
                } catch (error) {
                    console.error('异步处理callback逻辑失败:', error);
                }
            });
            
        } catch (error) {
            console.error('处理callback_query失败:', error);
        }
    });
    
    // 异步处理callback业务逻辑
    async function handleAsyncCallbackLogic(chatId, userId, data, query) {
        if (data.startsWith('attack_')) {
            const merchantId = data.replace('attack_', '');
            
            // 获取商家信息
            const merchant = dbOperations.getMerchantById(merchantId);
            if (!merchant) {
                await bot.sendMessage(chatId, '❌ 商家信息不存在');
                return;
            }
            
            // 检查商家状态
            if (merchant.status !== 'active') {
                await bot.sendMessage(chatId, '😔 抱歉，目前老师已下线，请看看其他老师吧～\n\n您可以使用 /start 命令重新查看可用的老师列表。');
                return;
            }
            
            // 获取用户信息
            const userName = query.from.first_name || '';
            const userLastName = query.from.last_name || '';
            const fullName = `${userName} ${userLastName}`.trim() || '未设置名称';
            const username = query.from.username ? `@${query.from.username}` : '未设置用户名';
            
            // 创建"尝试预约"状态的订单
            try {
                const orderData = {
                    booking_session_id: null, // 暂时为空，后续预约时关联
                    user_id: userId,
                    user_name: fullName,
                    user_username: username,
                    merchant_id: merchant.id,
                    merchant_user_id: merchant.user_id,
                    teacher_name: merchant.teacher_name,
                    teacher_contact: merchant.contact,
                    course_type: null, // 用户还未选择具体课程
                    course_content: '待确定课程',
                    price_range: '待确定价格',
                    status: 'attempting', // 尝试预约状态
                    user_evaluation: null,
                    merchant_evaluation: null,
                    report_content: null
                };
                
                const orderId = dbOperations.createOrder(orderData);
                
                console.log(`✅ 创建尝试预约订单成功: 订单ID ${orderId}, 用户 ${fullName} (${username}), 老师 ${merchant.teacher_name}`);
                
                // 记录用户点击行为到数据库
                dbOperations.logInteraction(userId, query.from.username, query.from.first_name, query.from.last_name, null, null, 'attack_click', chatId);
                
            } catch (error) {
                console.error('创建尝试预约订单失败:', error);
                // 继续执行，不影响用户体验
            }
            
            // 发送认证提示信息
            const attackMessage = `✅本榜单老师均已通过视频认证，请小鸡们放心预约。
————————————————————————————
🔔提示：
1.定金大多数不会超过100哦～ 
2.如果老师以前不需要定金，突然需要定金了，请跟管理员核实。`;
            
            const options = {
                reply_markup: {
                    inline_keyboard: [
                        [{ text: '预约p', callback_data: `book_p_${merchantId}` }],
                        [{ text: '预约pp', callback_data: `book_pp_${merchantId}` }],
                        [{ text: '其他时长', callback_data: `book_other_${merchantId}` }]
                    ]
                }
            };
            
            await bot.sendMessage(chatId, attackMessage, options);
            return;
        }
        
        // 处理频道点击
        if (data.startsWith('channel_')) {
            const merchantId = data.replace('channel_', '');
            
            // 获取商家信息
            const merchant = dbOperations.getMerchantById(merchantId);
            if (!merchant) {
                await bot.sendMessage(chatId, '❌ 商家信息不存在');
                return;
            }
            
            if (!merchant.channel_link || !merchant.channel_link.trim()) {
                await bot.sendMessage(chatId, '❌ 该老师暂未设置频道链接');
                return;
            }
            
            // 获取用户信息
            const userName = query.from.first_name || '';
            const userLastName = query.from.last_name || '';
            const fullName = `${userName} ${userLastName}`.trim() || '未设置名称';
            const username = query.from.username ? `@${query.from.username}` : '未设置用户名';
            
            try {
                // 记录频道点击到数据库
                const clickData = {
                    user_id: userId,
                    username: query.from.username,
                    first_name: query.from.first_name,
                    last_name: query.from.last_name,
                    merchant_id: merchantId,
                    merchant_name: merchant.teacher_name,
                    channel_link: merchant.channel_link
                };
                
                dbOperations.recordChannelClick(clickData);
                
                // 更新商家的频道点击计数
                dbOperations.incrementMerchantChannelClicks(merchantId);
                
                console.log(`✅ 记录频道点击: 用户 ${fullName} (${username}) 点击了商家 ${merchant.teacher_name} 的频道`);
                
                // 通知老师（如果有绑定的user_id）
                console.log(`🔍 检查商家绑定状态: ${merchant.teacher_name}, user_id: ${merchant.user_id || '未绑定'}`);
                
                if (merchant.user_id) {
                    const notificationMessage = `🐥小鸡提醒：用户（${username}）通过管家查看了您的频道。`;
                    
                    console.log(`📤 正在发送频道点击通知给商家 ${merchant.teacher_name} (${merchant.user_id})`);
                    
                    try {
                        await bot.sendMessage(merchant.user_id, notificationMessage);
                        console.log(`✅ 成功发送频道点击通知给商家 ${merchant.teacher_name} (${merchant.user_id})`);
                    } catch (error) {
                        console.error(`❌ 发送频道点击通知失败: 商家 ${merchant.teacher_name} (${merchant.user_id})`);
                        console.error(`   错误详情: ${error.message}`);
                        console.error(`   错误代码: ${error.code || '未知'}`);
                    }
                } else {
                    console.log(`⚠️ 商家 ${merchant.teacher_name} 未绑定user_id，无法发送频道点击通知`);
                }
                
            } catch (error) {
                console.error('记录频道点击失败:', error);
            }
            
            // 发送包含频道链接的消息，用户点击链接直接跳转
            const channelMessage = `🔗 ${merchant.teacher_name} 老师的频道：\n${merchant.channel_link}`;
            
            const channelOptions = {
                reply_markup: {
                    inline_keyboard: [
                        [{ text: '打开频道', url: merchant.channel_link }],
                        [{ text: '预约上课', callback_data: `attack_${merchantId}` }],
                        [{ text: '返回榜单', url: 'https://t.me/xiaoji233' }]
                    ]
                },
                disable_web_page_preview: false
            };
            
            // 使用不删除消息的方式发送
            await sendMessageWithoutDelete(chatId, channelMessage, channelOptions, 'channel_link', {
                merchantId: merchantId,
                channelLink: merchant.channel_link
            });
            return;
        }


        
        // 处理预约按钮点击
        if (data.startsWith('book_')) {
            const parts = data.split('_');
            const bookType = parts[1]; // p, pp, other
            const merchantId = parts[2];
            
            // 先缓存用户信息，避免重复获取
            const userName = query.from.first_name || '';
            const userLastName = query.from.last_name || '';
            const fullName = `${userName} ${userLastName}`.trim() || '未设置名称';
            const username = query.from.username ? `@${query.from.username}` : '未设置用户名';
            
            // 异步获取商家信息，避免阻塞
            const merchant = dbOperations.getMerchantById(merchantId);
            if (merchant) {
                // 检查商家状态
                if (merchant.status !== 'active') {
                    await bot.sendMessage(chatId, '😔 抱歉，目前老师已下线，请看看其他老师吧～\n\n您可以使用 /start 命令重新查看可用的老师列表。');
                    return;
                }
                
                // 确定预约类型的中文描述和价格
                let bookTypeText = '';
                let price = '待确定价格';
                switch (bookType) {
                    case 'p':
                        bookTypeText = 'p';
                        price = merchant.price1 || '未设置';
                        break;
                    case 'pp':
                        bookTypeText = 'pp';
                        price = merchant.price2 || '未设置';
                        break;
                    case 'other':
                        bookTypeText = '其他时长';
                        price = '其他';
                        break;
                }
                
                // 查找并更新之前创建的"尝试预约"订单
                try {
                    // 查找用户最近对该商家的"尝试预约"订单
                    const recentOrder = dbOperations.getRecentAttemptingOrder(userId, merchantId);
                    if (recentOrder) {
                        // 更新订单信息
                        const updateData = {
                            course_type: bookType,
                            course_content: bookTypeText,
                            price_range: price,
                            status: 'pending', // 更新状态为待确认
                            updated_at: Math.floor(Date.now() / 1000)
                        };
                        
                        dbOperations.updateOrderFields(recentOrder.id, updateData);
                        console.log(`✅ 更新订单成功: 订单ID ${recentOrder.id}, 课程 ${bookTypeText}, 价格 ${price}`);
                    }
                } catch (error) {
                    console.error('更新订单失败:', error);
                    // 继续执行，不影响用户体验
                }
                
                // 生成联系方式链接
                let contactLink = merchant.contact;
                if (contactLink && contactLink.startsWith('@')) {
                    contactLink = `[${contactLink}](https://t.me/${contactLink.substring(1)})`;
                }
                
                const finalMessage = `🐤小鸡出征！
         已将出击信息发送给${contactLink}老师。
         请点击 **联系方式主动私聊老师** 进行预约。`;
                
                // 发送联系老师信息（添加到消息跟踪系统）
                const contactOptions = {
                    parse_mode: 'Markdown'
                };
                
                const sentMessage = await bot.sendMessage(chatId, finalMessage, contactOptions);
                
                // 将联系老师信息添加到消息跟踪系统
                addMessageToHistory(userId, sentMessage.message_id, 'contact_teacher', {
                    merchantId: merchantId,
                    teacherName: merchant.teacher_name
                });
                
                // 后台异步处理（不阻塞用户体验）
                setImmediate(async () => {
                    try {
                        // 创建预约会话
                        const bookingSessionId = dbOperations.createBookingSession(userId, merchantId, bookType);
                        
                        // 发送通知给商家 - 优化逻辑处理管理员创建的商家
                        if (merchant.user_id) {
                            // 正常绑定的商家，直接发送通知
                            const merchantNotification = `老师您好，
用户名称 ${fullName}（${username}）即将与您进行联系。他想跟您预约${bookTypeText}课程
请及时关注私聊信息。
————————————————————————
🐤小鸡出征！请尽力服务好我们的勇士～
如遇任何问题，请群内联系小鸡管理员。`;
                            
                            bot.sendMessage(merchant.user_id, merchantNotification).catch(error => {
                                console.log(`无法发送通知给商家 ${merchant.user_id}: ${error.message}`);
                            });
                            
                            console.log(`已通知商家 ${merchant.user_id}，用户 ${fullName} (${username}) 预约了 ${bookTypeText}`);
                        } else {
                            // 管理员创建但未绑定的商家，记录预约信息并提示用户
                            console.log(`⚠️ 商家 ${merchant.teacher_name} (ID: ${merchantId}) 尚未绑定Telegram账户，无法接收通知`);
                            console.log(`📋 预约信息已记录：用户 ${fullName} (${username}) 预约了 ${bookTypeText}`);
                            
                            // 可以考虑发送到管理员群组或记录到特殊表中
                            // 这里先记录日志，后续可以扩展为更完善的通知机制
                        }
                        
                        // 记录交互（异步）
                        dbOperations.logInteraction(userId, query.from.username, query.from.first_name, query.from.last_name, null, null, `book_${bookType}`, chatId);
                        
                        // 延迟2秒发送约课成功确认消息
                        setTimeout(async () => {
                            await sendBookingSuccessCheck(userId, bookingSessionId, merchant, bookType, fullName, username);
                        }, 2000);
                        
                        console.log(`用户 ${userId} ${fullName} (${username}) 预约了商家 ${merchantId} (${bookType})`);
                        
                    } catch (error) {
                        console.error('后台处理预约流程失败:', error);
                    }
                });
            }
            return;
        }

        // 绑定流程已简化，不再需要复杂的多步骤绑定按钮处理
        
        // 地区选择处理已移除（绑定流程已简化）
        // 绑定流程上一步按钮处理已移除（绑定流程已简化）

        // 处理原有按钮点击
        if (data.startsWith('contact_')) {
            const buttonId = data.replace('contact_', '');
            
            setImmediate(() => {
                try {
                    dbOperations.incrementButtonClick(buttonId);
                    
                    const button = dbOperations.getButton(buttonId);
                    if (!button) {
                        bot.sendMessage(userId, '❌ 按钮信息不存在');
                        return;
                    }

                    const message = button.message || '您好！感谢您的咨询，我们会尽快回复您！';
                    bot.sendMessage(userId, `📞 ${message}`).catch(error => {
                        console.log(`无法发送消息给用户 ${userId}: ${error.message}`);
                    });
                    
                    dbOperations.logInteraction(userId, query.from.username, query.from.first_name, query.from.last_name, buttonId, null, 'click', chatId);
                    console.log(`用户 ${userId} 点击了按钮 ${buttonId}`);
                } catch (error) {
                    console.error('处理按钮点击错误:', error);
                }
            });
            return;
        } else if (data.startsWith('template_')) {
            // 处理模板按钮点击
            const parts = data.split('_');
            const templateId = parts[1];
            
            setImmediate(() => {
                try {
                    // 从数据库获取模板，而不是依赖缓存
                    const template = dbOperations.getMessageTemplateById(templateId);
                    if (template) {
                        bot.sendMessage(userId, `📞 ${template.content}`).catch(error => {
                            console.log(`无法发送消息给用户 ${userId}: ${error.message}`);
                        });
                        
                        dbOperations.logInteraction(userId, query.from.username, query.from.first_name, query.from.last_name, null, templateId, 'template_click', chatId);
                        console.log(`用户 ${userId} 点击了模板按钮 ${templateId}`);
                    } else {
                        // 模板不存在，发送默认消息
                        console.log(`模板 ${templateId} 不存在，发送默认联系消息`);
                        bot.sendMessage(userId, `📞 感谢您的咨询，我们会尽快回复您！`).catch(error => {
                            console.log(`无法发送消息给用户 ${userId}: ${error.message}`);
                        });
                    }
                } catch (error) {
                    console.error('处理模板按钮点击错误:', error);
                    // 发送错误处理消息
                    bot.sendMessage(userId, `📞 感谢您的咨询，我们会尽快回复您！`).catch(e => {
                        console.log(`无法发送错误消息给用户 ${userId}: ${e.message}`);
                    });
                }
            });
            return;
        }
        
        // 处理课程完成流程
        else if (data.startsWith('course_')) {
            await handleCourseFlow(userId, data, query);
            return;
        }
        
        // 处理重新预约流程
        else if (data.startsWith('rebook_')) {
            await handleRebookFlow(userId, data, query);
            return;
        }
        
        // 处理返回按钮
        else if (data.startsWith('back_')) {
            
            console.log(`处理返回按钮: ${data}`);
            const backType = data.replace('back_', '');
            const parts = backType.split('_');
            const action = parts[0];
            const sessionId = parts[parts.length - 1];
            console.log(`返回按钮解析: action=${action}, parts=${JSON.stringify(parts)}, sessionId=${sessionId}`);
            
            switch (action) {
                case 'contact':
                    // 返回到预约选择页面
                    await handleBackToBookingOptions(userId, sessionId);
                    break;
                    
                case 'course':
                    // 返回到联系老师页面
                    await handleBackToContact(userId, sessionId);
                    break;
                    
                case 'rebook':
                    // 返回到课程完成确认
                    await handleBackToCourseCompletion(userId, sessionId);
                    break;
                    
                case 'user':
                    if (parts[1] === 'evaluation') {
                        // 返回到课程完成确认
                        await handleBackToCourseCompletion(userId, sessionId);
                    } else if (parts[1] === 'eval') {
                        // 用户评价中的返回 - 返回到上一个评价步骤
                        await handleUserEvaluationBack(userId, data, query);
                    }
                    break;
                    
                case 'merchant':
                    if (parts[1] === 'evaluation') {
                        if (parts[2] === 'modify') {
                            // 商家评分修改页面返回到评分确认
                            await handleBackToMerchantScoreConfirm(userId, sessionId);
                        } else {
                            // 返回到课程完成确认
                            await handleBackToCourseCompletion(userId, sessionId);
                        }
                    } else if (parts[1] === 'score' && parts[2] === 'confirm') {
                        // 商家评分确认页面返回到评分选择
                        await handleBackToMerchantScoring(userId, sessionId);
                    } else if (parts[1] === 'detail') {
                        if (parts[2] === 'confirm') {
                            // 商家详细评价确认页面返回
                            await handleMerchantDetailEvaluationBack(userId, data, query);
                        } else if (parts[2] === 'eval') {
                            // 商家详细评价中的返回
                            await handleMerchantDetailEvaluationBack(userId, data, query);
                        }
                    }
                    break;
                    
                case 'detail':
                    if (parts[1] === 'eval') {
                        if (parts[2] === 'summary') {
                            // 详细评价总结页面返回到上一步
                            await handleDetailedEvaluationBack(userId, data, query);
                        } else {
                            // 详细评价中的返回
                            await handleDetailedEvaluationBack(userId, data, query);
                        }
                    }
                    break;
                    
                case 'broadcast':
                    if (parts[1] === 'choice') {
                        // 播报选择页面返回到评价总结
                        await handleBackToBroadcastChoice(userId, sessionId);
                    }
                    break;
                    
                default:
                    await sendMessageWithDelete(userId, '已返回上一步', {}, 'back_default');
                    break;
            }
            return;
        }
        
        // 处理约课成功确认
        else if (data.startsWith('booking_success_') || data.startsWith('booking_failed_')) {
            console.log(`路由到约课成功确认处理: ${data}`);
            await handleBookingSuccessFlow(userId, data, query);
            return;
        }
        
        // 处理评价流程 - 分离UI更新和业务逻辑
        else if (data.startsWith('evaluate_') || data.startsWith('eval_') || data.startsWith('user_eval_') || data.startsWith('merchant_detail_eval_')) {
            // 评分按钮 - 需要区分商家评价和用户评价
            if (data.startsWith('eval_score_')) {
                const parts = data.split('_');
                if (parts.length === 5) {
                    // 用户评价项目评分 eval_score_type_X_evaluationId - 最小化处理，即时UI反馈
                    await handleMinimalEvalScoring(userId, data, query);
                    return;
                } else {
                    // 其他eval_score格式（如商家评价）走正常评价流程
                    console.log(`路由到评价流程处理: ${data}`);
                    await handleEvaluationFlow(userId, data, query);
                    return;
                }
            }
            
            // 其他评价相关按钮走正常流程
            console.log(`路由到评价流程处理: ${data}`);
            await handleEvaluationFlow(userId, data, query);
            return;
        }
        
        // 处理播报选择
        else if (data.startsWith('broadcast_')) {
            console.log(`路由到播报选择处理: ${data}`);
            await handleBroadcastChoice(userId, data, query);
            return;
        }
        
        // 如果没有匹配到任何处理逻辑，记录日志并发送默认响应
        else {
            console.log(`未处理的callback data: ${data}`);
            // 对于未知的callback_data，发送默认联系信息
            try {
                if (data.includes('联系') || data.includes('contact')) {
                    await bot.sendMessage(userId, `📞 感谢您的咨询，我们会尽快回复您！`);
                } else {
                    // 不再显示"操作已处理"，避免干扰正常流程
                    console.log(`跳过未知callback处理: ${data}`);
                }
            } catch (error) {
                console.error('发送默认响应失败:', error);
            }
        }
    }
}

// 发送预约确认消息
// 预约确认功能已移除，直接进入课程完成确认流程

// 发送课程完成确认消息
async function sendCourseCompletionCheck(userId, merchantId, bookingSessionId, userFullName, username, teacherName) {
    try {
        // 获取商家信息以获取联系方式
        const bookingSession = dbOperations.getBookingSession(bookingSessionId);
        let teacherContact = teacherName; // 默认使用艺名
        
        if (bookingSession) {
            const merchant = dbOperations.getMerchantById(bookingSession.merchant_id);
            if (merchant && merchant.contact) {
                // 确保联系方式有@符号
                teacherContact = merchant.contact.startsWith('@') ? merchant.contact : `@${merchant.contact}`;
            }
        }
        
        // 给用户发送
        const userMessage = `是否完成该老师（${teacherName} ${teacherContact}）的课程？`;
        const userKeyboard = {
            inline_keyboard: [
                [
                    { text: '已完成', callback_data: `course_completed_${bookingSessionId}` },
                    { text: '未完成', callback_data: `course_incomplete_${bookingSessionId}` }
                ]
            ]
        };
        
        // 使用不删除历史的方式发送课程完成确认消息，保留此信息
        await sendMessageWithoutDelete(userId, userMessage, { 
            reply_markup: userKeyboard 
        }, 'course_completion_check', {
            bookingSessionId,
            merchantId,
            userFullName,
            username,
            teacherName,
            teacherContact
        });
        
        // 给商家发送 - 只发送一次确认消息
        const merchantMessage = `是否完成该用户（${userFullName}）的课程？`;
        const merchantKeyboard = {
            inline_keyboard: [
                [
                    { text: '已完成', callback_data: `course_completed_${bookingSessionId}` },
                    { text: '未完成', callback_data: `course_incomplete_${bookingSessionId}` }
                ]
            ]
        };
        
        // 只有真实用户ID才发送给商家
        if (merchantId < 9000000000) {
            // 使用不删除历史的方式发送课程完成确认消息，保留此信息
            await sendMessageWithoutDelete(merchantId, merchantMessage, { 
                reply_markup: merchantKeyboard 
            }, 'course_completion_check', {
                bookingSessionId,
                userId,
                userFullName,
                username,
                teacherName,
                teacherContact
            });
        }
        
    } catch (error) {
        console.error('发送课程完成确认消息失败:', error);
    }
}

// 处理课程完成流程
async function handleCourseFlow(userId, data, query) {
    try {
        if (data.startsWith('course_completed_')) {
            const bookingSessionId = data.replace('course_completed_', '');
            const bookingSession = dbOperations.getBookingSession(bookingSessionId);
            
            if (bookingSession) {
                // 判断是用户还是商家
                const isUser = userId === bookingSession.user_id;
                const isMerchant = userId === dbOperations.getMerchantById(bookingSession.merchant_id)?.user_id;
                
                if (isUser) {
                    // 用户确认课程完成
                    dbOperations.updateUserCourseStatus(bookingSessionId, 'completed');
                    
                    await sendMessageWithoutDelete(userId, '✅ 您已确认课程完成，即将进入评价环节', {}, 'course_completed');
                    
                    // 用户进入评价流程
                    setTimeout(() => {
                        startUserEvaluation(userId, bookingSessionId);
                    }, 1000);
                    
                } else if (isMerchant) {
                    // 商家确认课程完成
                    dbOperations.updateMerchantCourseStatus(bookingSessionId, 'completed');
                    
                    await sendMessageWithoutDelete(userId, '✅ 您已确认课程完成，即将进入评价环节', {}, 'course_completed');
                    
                    // 商家进入评价流程
                    setTimeout(() => {
                        startMerchantEvaluation(userId, bookingSessionId);
                    }, 1000);
                }
                
                console.log(`${isUser ? '用户' : '商家'} ${userId} 确认课程完成，预约会话 ${bookingSessionId}`);
                
            } else {
                console.log('预约信息不存在');
            }
            
        } else if (data.startsWith('course_incomplete_')) {
            const bookingSessionId = data.replace('course_incomplete_', '');
            const bookingSession = dbOperations.getBookingSession(bookingSessionId);
            
            if (bookingSession) {
                // 判断是用户还是商家
                const isUser = userId === bookingSession.user_id;
                const isMerchant = userId === dbOperations.getMerchantById(bookingSession.merchant_id)?.user_id;
                
                if (isUser) {
                    dbOperations.updateUserCourseStatus(bookingSessionId, 'incomplete');
                    
                    await sendMessageWithoutDelete(userId, '课程未完成，是否重新预约？', {
                        reply_markup: {
                            inline_keyboard: [
                                [
                                    { text: '是', callback_data: `rebook_yes_${bookingSessionId}` },
                                    { text: '否', callback_data: `rebook_no_${bookingSessionId}` }
                                ]
                            ]
                        }
                    }, 'rebook_question', { bookingSessionId });
                    
                } else if (isMerchant) {
                    dbOperations.updateMerchantCourseStatus(bookingSessionId, 'incomplete');
                    
                    await sendMessageWithoutDelete(userId, '您已标记课程未完成', {}, 'course_incomplete_merchant');
                }
                
                console.log(`${isUser ? '用户' : '商家'} ${userId} 标记课程未完成，预约会话 ${bookingSessionId}`);
                
            } else {
                console.log('预约信息不存在');
            }
        }
    } catch (error) {
        console.error('处理课程完成流程失败:', error);
    }
}

// 发送重新预约询问
async function sendRebookingQuestion(userId, merchantId, bookingSessionId) {
    try {
        const message = `是否重新预约？`;
        const keyboard = {
            inline_keyboard: [[
                { text: '是', callback_data: `rebook_yes_${bookingSessionId}` },
                { text: '否', callback_data: `rebook_no_${bookingSessionId}` }
            ]]
        };
        
        bot.sendMessage(userId, message, { reply_markup: keyboard });
        bot.sendMessage(merchantId, message, { reply_markup: keyboard });
        
    } catch (error) {
        console.error('发送重新预约询问失败:', error);
    }
}

// 只给用户发送重新预约询问
async function sendRebookingQuestionToUser(userId, bookingSessionId) {
    try {
        const message = `是否重新预约？`;
        const keyboard = {
            inline_keyboard: [[
                { text: '是', callback_data: `rebook_yes_${bookingSessionId}` },
                { text: '否', callback_data: `rebook_no_${bookingSessionId}` }
            ]]
        };
        
        bot.sendMessage(userId, message, { reply_markup: keyboard });
        
    } catch (error) {
        console.error('发送重新预约询问失败:', error);
    }
}

// 处理重新预约流程
async function handleRebookFlow(userId, data, query) {
    try {
        if (data.startsWith('rebook_no_')) {
            const bookingSessionId = data.replace('rebook_no_', '');
            
            // 获取对应的订单并更新状态为"已取消"
            const order = dbOperations.getOrderByBookingSession(bookingSessionId);
            if (order) {
                dbOperations.updateOrderStatus(order.id, 'cancelled');
                console.log(`订单 ${order.id} 状态已更新为"已取消"，原因：用户选择不重新预约`);
            }
            
            // 清空本轮对话历史
            await clearUserConversation(userId);
            
            // 发送最终消息（不使用消息管理系统，避免被跟踪）
            await bot.sendMessage(userId, '欢迎下次预约课程📅 🐤小鸡与你同在。');
            
            console.log(`用户 ${userId} 选择不重新预约，预约会话 ${bookingSessionId}`);
            
        } else if (data.startsWith('rebook_p_') || data.startsWith('rebook_pp_') || data.startsWith('rebook_other_')) {
            // 处理重新预约的具体课程选择 - 创建新的预约会话和订单
            const parts = data.split('_');
            const bookType = parts[1]; // p, pp, other
            const merchantId = parts[2];
            
            // 获取用户信息
            const userName = query.from.first_name || '';
            const userLastName = query.from.last_name || '';
            const fullName = `${userName} ${userLastName}`.trim() || '未设置名称';
            const username = query.from.username ? `@${query.from.username}` : '未设置用户名';
            
            // 获取商家信息
            const merchant = dbOperations.getMerchantById(merchantId);
            if (merchant) {
                // 检查商家状态
                if (merchant.status !== 'active') {
                    await sendMessageWithoutDelete(userId, '😔 抱歉，目前老师已下线，请看看其他老师吧～', {}, 'merchant_offline');
                    return;
                }
                
                // 确定预约类型的中文描述和价格
                let bookTypeText = '';
                let price = '待确定价格';
                switch (bookType) {
                    case 'p':
                        bookTypeText = 'p';
                        price = merchant.price1 || '未设置';
                        break;
                    case 'pp':
                        bookTypeText = 'pp';
                        price = merchant.price2 || '未设置';
                        break;
                    case 'other':
                        bookTypeText = '其他时长';
                        price = '其他';
                        break;
                }
                
                // 创建新的预约会话（重新预约）
                const newBookingSessionId = dbOperations.createBookingSession(userId, merchantId, bookType);
                
                // 创建新的订单记录
                try {
                    const orderData = {
                        booking_session_id: newBookingSessionId,
                        user_id: userId,
                        user_name: fullName,
                        user_username: username,
                        merchant_id: merchant.id,
                        merchant_user_id: merchant.user_id,
                        teacher_name: merchant.teacher_name,
                        teacher_contact: merchant.contact,
                        course_type: bookType,
                        course_content: bookTypeText,
                        price_range: price,
                        status: 'pending', // 新订单状态为待确认
                        user_evaluation: null,
                        merchant_evaluation: null,
                        report_content: null
                    };
                    
                    const newOrderId = dbOperations.createOrder(orderData);
                    console.log(`✅ 创建重新预约订单成功: 订单ID ${newOrderId}, 预约会话 ${newBookingSessionId}, 用户 ${fullName}, 老师 ${merchant.teacher_name}, 课程 ${bookTypeText}`);
                    
                } catch (error) {
                    console.error('创建重新预约订单失败:', error);
                    await sendMessageWithoutDelete(userId, '❌ 重新预约失败，请稍后再试', {}, 'rebook_error');
                    return;
                }
                
                // 发送通知给商家 - 优化逻辑处理管理员创建的商家
                if (merchant.user_id) {
                    // 正常绑定的商家，直接发送通知
                    const merchantNotification = `老师您好，
用户名称 ${fullName}（${username}）即将与您进行联系。他想跟您重新预约${bookTypeText}课程
请及时关注私聊信息。
————————————————————————
🐤小鸡出征！请尽力服务好我们的勇士～
如遇任何问题，请群内联系小鸡管理员。`;
                    
                    bot.sendMessage(merchant.user_id, merchantNotification).catch(error => {
                        console.log(`无法发送通知给商家 ${merchant.user_id}: ${error.message}`);
                    });
                    
                    console.log(`已通知商家 ${merchant.user_id}，用户 ${fullName} (${username}) 重新预约了 ${bookTypeText}`);
                } else {
                    // 管理员创建但未绑定的商家，记录预约信息并提示用户
                    console.log(`⚠️ 商家 ${merchant.teacher_name} (ID: ${merchantId}) 尚未绑定Telegram账户，无法接收通知`);
                    console.log(`📋 重新预约信息已记录：用户 ${fullName} (${username}) 重新预约了 ${bookTypeText}`);
                    
                    // 可以考虑发送到管理员群组或记录到特殊表中
                    // 这里先记录日志，后续可以扩展为更完善的通知机制
                }
                
                // 生成联系方式链接
                let contactLink = merchant.contact;
                if (contactLink && contactLink.startsWith('@')) {
                    contactLink = `[${contactLink}](https://t.me/${contactLink.substring(1)})`;
                }
                
                const finalMessage = `🐤小鸡出征！
         已将出击信息发送给${contactLink}老师。
         请点击 **联系方式主动私聊老师** 进行预约。`;
                
                // 发送联系老师信息
                const contactOptions = {
                    parse_mode: 'Markdown'
                };
                
                const sentMessage = await bot.sendMessage(userId, finalMessage, contactOptions);
                
                // 将联系老师信息添加到消息跟踪系统
                addMessageToHistory(userId, sentMessage.message_id, 'contact_teacher', {
                    merchantId: merchantId,
                    teacherName: merchant.teacher_name,
                    isRebook: true
                });
                
                // 延迟2秒发送约课成功确认消息
                setTimeout(async () => {
                    await sendBookingSuccessCheck(userId, newBookingSessionId, merchant, bookType, fullName, username);
                }, 2000);
                
                // 记录交互
                dbOperations.logInteraction(userId, query.from.username, query.from.first_name, query.from.last_name, null, null, `rebook_${bookType}`, userId);
                console.log(`用户 ${userId} ${fullName} (${username}) 重新预约了商家 ${merchantId} (${bookType})`);
            }
            
        } else if (data.startsWith('rebook_yes_')) {
            const bookingSessionId = data.replace('rebook_yes_', '');
            const bookingSession = dbOperations.getBookingSession(bookingSessionId);
            
            if (bookingSession) {
                await sendMessageWithoutDelete(userId, '正在为您重新安排预约...', {}, 'rebook_processing');
                
                const merchant = dbOperations.getMerchantById(bookingSession.merchant_id);
                if (!merchant) {
                    console.error(`找不到商家信息，merchant_id: ${bookingSession.merchant_id}`);
                    return;
                }
                
                // 清除该用户对该商家的预约冷却时间，允许重新预约
                const cooldownKey = `${userId}_${merchant.id}`;
                bookingCooldowns.delete(cooldownKey);
                console.log(`重新预约时已清除用户 ${userId} 对商家 ${merchant.id} 的预约冷却时间`);
                
                const userFullName = `${query.from.first_name || ''} ${query.from.last_name || ''}`.trim() || '未设置名称';
                const username = query.from.username ? `@${query.from.username}` : '未设置用户名';
                
                console.log(`用户 ${userId} 选择重新预约，预约会话 ${bookingSessionId}`);
                
                // 清空本轮对话历史，准备重新开始预约流程
                await clearUserConversation(userId);
                
                // 重新发送"小鸡出征"的老师信息和预约选择按钮
                // 生成联系方式链接
                let contactLink = merchant.contact;
                if (contactLink && contactLink.startsWith('@')) {
                    contactLink = `[${contactLink}](https://t.me/${contactLink.substring(1)})`;
                }
                
                const finalMessage = `🐤小鸡出征！
         已将出击信息发送给${contactLink}老师。
         请点击 **联系方式主动私聊老师** 进行预约。`;
                
                // 发送联系老师信息
                const contactOptions = {
                    parse_mode: 'Markdown'
                };
                
                const sentMessage = await bot.sendMessage(userId, finalMessage, contactOptions);
                
                // 将联系老师信息添加到消息跟踪系统
                addMessageToHistory(userId, sentMessage.message_id, 'contact_teacher', {
                    merchantId: merchant.id,
                    teacherName: merchant.teacher_name
                });
                
                // 重新发送预约选择按钮（重新进入原本的预约流程）
                const attackMessage = `✅本榜单老师均已通过视频认证，请小鸡们放心预约。
————————————————————————————
🔔提示：
1.定金大多数不会超过100哦～ 
2.如果老师以前不需要定金，突然需要定金了，请跟管理员核实。`;
                
                const options = {
                    reply_markup: {
                        inline_keyboard: [
                            [{ text: '预约p', callback_data: `rebook_p_${merchant.id}` }],
                            [{ text: '预约pp', callback_data: `rebook_pp_${merchant.id}` }],
                            [{ text: '其他时长', callback_data: `rebook_other_${merchant.id}` }]
                        ]
                    }
                };
                
                // 延迟1秒发送预约选择按钮，让用户先看到"小鸡出征"消息
                setTimeout(async () => {
                    await sendMessageWithDelete(userId, attackMessage, options, 'booking_options', {
                        merchantId: merchant.id,
                        isRebook: true // 标记这是重新预约
                    });
                }, 1000);
                
            } else {
                console.log('预约信息不存在');
            }
        }
    } catch (error) {
        console.error('处理重新预约流程失败:', error);
    }
}

// 发送课程完成祝贺消息
// sendCourseCompletedMessage函数已移除，评价流程现在在各自确认课程完成后直接触发

// 处理评价流程
async function handleEvaluationFlow(userId, data, query) {
    try {
        if (data.startsWith('evaluate_user_')) {
            const bookingSessionId = data.replace('evaluate_user_', '');
            startMerchantEvaluation(userId, bookingSessionId);
            
        } else if (data.startsWith('evaluate_teacher_')) {
            const bookingSessionId = data.replace('evaluate_teacher_', '');
            startUserEvaluation(userId, bookingSessionId);
            
        } else if (data.startsWith('eval_score_')) {
            // 处理评分 - 需要区分商家评分和用户评分
            const parts = data.split('_');
            if (parts.length === 4) {
                // 商家评价勇士的总体评分 eval_score_X_evaluationId
                handleMerchantScoring(userId, data, query);
            } else if (parts.length === 5) {
                // 用户评价项目评分 eval_score_type_X_evaluationId
                handleUserScoring(userId, data, query);
            } else {
                console.log(`未识别的eval_score格式: ${data}, 部分数: ${parts.length}`);
            }
            
        } else if (data.startsWith('eval_submit_')) {
            // 处理评价提交
            handleEvaluationSubmit(userId, data, query);
            
        } else if (data === 'eval_incomplete' || data.startsWith('eval_info_')) {
            // 处理无效按钮点击
            handleInvalidEvaluationClick(userId, data, query);
            
        } else if (data.startsWith('user_eval_')) {
            // 处理用户评价老师（兼容旧版本）
            if (data.includes('_confirm_')) {
                handleUserEvaluationConfirm(userId, data, query);
            } else if (data.includes('_restart_')) {
                handleUserEvaluationRestart(userId, data, query);
            } else if (data.includes('_back_')) {
                handleUserEvaluationBack(userId, data, query);
            } else {
                // 旧版本的评分处理
                handleUserScoring(userId, data, query);
            }
        } else if (data.startsWith('eval_confirm_') || data.startsWith('eval_modify_')) {
            // 处理商家评价确认
            handleMerchantEvaluationConfirm(userId, data, query);
        } else if (data.startsWith('detailed_eval_')) {
            // 处理详细评价
            console.log(`处理详细评价回调: ${data}, 用户: ${userId}`);
            handleDetailedEvaluation(userId, data, query);
            return;
        } else if (data.startsWith('broadcast_')) {
            // 处理播报选择
            handleBroadcastChoice(userId, data, query);
        } else if (data.startsWith('detail_')) {
            // 处理详细评价评分
            if (data.includes('_confirm_') || data.includes('_restart_')) {
                handleDetailedEvaluationConfirm(userId, data, query);
            } else {
                handleDetailedEvaluationScoring(userId, data, query);
            }
        } else if (data.startsWith('merchant_detail_eval_')) {
            // 处理商家详细评价
            if (data.includes('_confirm_') || data.includes('_restart_')) {
                handleMerchantDetailEvaluationConfirm(userId, data, query);
            } else if (data.includes('_back_')) {
                handleMerchantDetailEvaluationBack(userId, data, query);
            } else {
                handleMerchantDetailEvaluationScoring(userId, data, query);
            }
        } else if (data.startsWith('user_text_')) {
            // 处理用户文字评价
            handleUserTextComment(userId, data, query);
        } else {
            // 处理其他未匹配的评价相关回调
            console.log(`评价流程中未处理的callback data: ${data}`);
        }
    } catch (error) {
        console.error('处理评价流程失败:', error);
    }
}

// 开始商家评价勇士流程
async function startMerchantEvaluation(userId, bookingSessionId) {
    try {
        const bookingSession = dbOperations.getBookingSession(bookingSessionId);
        if (!bookingSession) return;
        

        // 检查商家是否已经评价过
        const existingMerchantEval = dbOperations.db.prepare(`
            SELECT status FROM evaluations 
            WHERE booking_session_id = ? AND evaluator_type = 'merchant'
        `).get(bookingSessionId);
        
        if (existingMerchantEval && existingMerchantEval.status === 'completed') {
            await sendMessageWithDelete(userId, 
                '✅ 您已完成对该订单的评价。', 
                {}, 'already_evaluated'
            );
            return;
        }
        
        // 创建评价记录
        const evaluationId = dbOperations.createEvaluation(bookingSessionId, 'merchant', userId, bookingSession.user_id);
        const sessionId = dbOperations.createEvaluationSession(userId, evaluationId);
        
        // 开始评价流程
        const message = `出击总体素质：`;
        const keyboard = {
            inline_keyboard: [
                [
                    { text: '1', callback_data: `eval_score_1_${evaluationId}` },
                    { text: '2', callback_data: `eval_score_2_${evaluationId}` },
                    { text: '3', callback_data: `eval_score_3_${evaluationId}` },
                    { text: '4', callback_data: `eval_score_4_${evaluationId}` },
                    { text: '5', callback_data: `eval_score_5_${evaluationId}` }
                ],
                [
                    { text: '6', callback_data: `eval_score_6_${evaluationId}` },
                    { text: '7', callback_data: `eval_score_7_${evaluationId}` },
                    { text: '8', callback_data: `eval_score_8_${evaluationId}` },
                    { text: '9', callback_data: `eval_score_9_${evaluationId}` },
                    { text: '10', callback_data: `eval_score_10_${evaluationId}` }
                ],
                [
                    { text: '⬅️ 返回', callback_data: `back_merchant_evaluation_${bookingSessionId}` }
                ]
            ]
        };
        
        await sendMessageWithDelete(userId, message, { 
            reply_markup: keyboard 
        }, 'merchant_evaluation', {
            evaluationId,
            bookingSessionId,
            step: 'overall_score'
        });
        
        // 更新评价会话状态
        dbOperations.updateEvaluationSession(sessionId, 'overall_score', {});
        
    } catch (error) {
        console.error('开始商家评价流程失败:', error);
    }
}

// 处理商家评分
async function handleMerchantScoring(userId, data, query) {
    try {
        const parts = data.split('_');
        const score = parseInt(parts[2]);
        const evaluationId = parts[3];
        
        // 发送确认消息
        const message = `是否确认提交该勇士素质为 ${score} 分？`;
        const keyboard = {
            inline_keyboard: [
                [
                    { text: '确认✅', callback_data: `eval_confirm_${score}_${evaluationId}` },
                    { text: '修改✍️', callback_data: `eval_modify_${evaluationId}` }
                ],
                [
                    { text: '⬅️ 返回', callback_data: `back_merchant_score_confirm_${evaluationId}` }
                ]
            ]
        };
        
        await sendMessageWithDelete(userId, message, { reply_markup: keyboard }, 'merchant_score_confirm', {
            evaluationId,
            score
        });
        
    } catch (error) {
        console.error('处理商家评分失败:', error);
    }
}

// 开始用户评价老师流程
// 用于存储用户评价状态的内存映射
const userEvaluationStates = new Map();

async function startUserEvaluation(userId, bookingSessionId) {
    try {
        const bookingSession = dbOperations.getBookingSession(bookingSessionId);
        if (!bookingSession) return;
        
        // 创建评价记录
        const evaluationId = dbOperations.createEvaluation(bookingSessionId, 'user', userId, bookingSession.merchant_id);
        const sessionId = dbOperations.createEvaluationSession(userId, evaluationId);
        
        // 初始化用户评价状态
        userEvaluationStates.set(userId, {
            evaluationId,
            sessionId,
            scores: {},
            completedCount: 0,
            messageId: null
        });
        
        // 发送一次性评价界面
        await sendComprehensiveEvaluationForm(userId, evaluationId);
        
    } catch (error) {
        console.error('开始用户评价流程失败:', error);
    }
}

// 发送一次性评价表单
async function sendComprehensiveEvaluationForm(userId, evaluationId, messageId = null) {
    try {
        // 硬件评价项目（6项）
        const hardwareItems = [
            { key: 'appearance', name: '颜值' },
            { key: 'breasts', name: '咪咪' },
            { key: 'waist', name: '腰腹' },
            { key: 'legs', name: '腿型' },
            { key: 'feet', name: '脚型' },
            { key: 'tightness', name: '松紧' }
        ];
        
        // 软件评价项目（6项）
        const softwareItems = [
            { key: 'temperament', name: '气质' },
            { key: 'environment', name: '环境' },
            { key: 'sexiness', name: '骚气' },
            { key: 'attitude', name: '态度' },
            { key: 'voice', name: '叫声' },
            { key: 'initiative', name: '主动' }
        ];
        
        const userState = userEvaluationStates.get(userId) || { scores: {}, completedCount: 0, messageId: null };
        
        // 发送第一条消息：硬件评价
        await sendEvaluationSection(userId, evaluationId, hardwareItems, userState, '🔧 硬件评价', '📋 请根据您的体验进行老师综合评价：\n🫶 这会对老师的数据有帮助\n\n');
        
        // 发送第二条消息：软件评价 - 同样包含说明文字保持UI一致
        await sendEvaluationSection(userId, evaluationId, softwareItems, userState, '💎 软件评价', '📋 请根据您的体验进行老师综合评价：\n🫶 这会对老师的数据有帮助\n\n');
        
    } catch (error) {
        console.error('发送综合评价表单失败:', error);
    }
}

// 发送单个评价板块的函数
async function sendEvaluationSection(userId, evaluationId, items, userState, sectionTitle, headerText = '') {
    try {
        // 构建消息文本
        const message = `${headerText}${sectionTitle}：

💡 点击下方按钮评分（1-10分）：`;
        
        // 构建键盘布局
        const keyboard = {
            inline_keyboard: []
        };
        
        // 为每个评价项目创建三行布局：标题行 + 1-5分行 + 6-10分行
        items.forEach(item => {
            const currentScore = userState.scores[item.key];
            
            // 第一行：显示评价项目名称和当前评分状态
            const titleRow = [{
                text: currentScore ? `${item.name} ✅${currentScore}分` : `${item.name} (未评分)`,
                callback_data: `eval_info_${item.key}`
            }];
            keyboard.inline_keyboard.push(titleRow);
            
            // 第二行：1-5分评分按钮
            const scoreRow1 = [];
            for (let i = 1; i <= 5; i++) {
                scoreRow1.push({
                    text: currentScore === i ? `✅${i}` : `${i}`,
                    callback_data: `eval_score_${item.key}_${i}_${evaluationId}`
                });
            }
            keyboard.inline_keyboard.push(scoreRow1);
            
            // 第三行：6-10分评分按钮
            const scoreRow2 = [];
            for (let i = 6; i <= 10; i++) {
                scoreRow2.push({
                    text: currentScore === i ? `✅${i}` : `${i}`,
                    callback_data: `eval_score_${item.key}_${i}_${evaluationId}`
                });
            }
            keyboard.inline_keyboard.push(scoreRow2);
        });
        
        // 在软件评价消息中添加提交和返回按钮
        if (sectionTitle.includes('软件')) {
            // 添加提交按钮
            if (userState.completedCount === 12) {
                keyboard.inline_keyboard.push([
                    { text: '🎉 提交完整评价', callback_data: `eval_submit_${evaluationId}` }
                ]);
            } else {
                keyboard.inline_keyboard.push([
                    { text: `⏳ 请完成所有评价 (${userState.completedCount}/12)`, callback_data: 'eval_incomplete' }
                ]);
            }
            
            keyboard.inline_keyboard.push([
                { text: '⬅️ 返回', callback_data: `back_user_eval_${evaluationId}` }
            ]);
        }
        
        // 发送消息
        const sentMessage = await bot.sendMessage(userId, message, { reply_markup: keyboard });
        
        // 如果是硬件评价（第一条消息），保存messageId到userState
        if (sectionTitle.includes('硬件')) {
            userState.messageId = sentMessage.message_id;
            userState.softwareMessageId = null; // 重置软件消息ID
            userEvaluationStates.set(userId, userState);
        } else {
            // 软件评价消息，保存软件消息ID
            userState.softwareMessageId = sentMessage.message_id;
            userEvaluationStates.set(userId, userState);
        }
        
        // 记录消息历史
        addMessageToHistory(userId, sentMessage.message_id, 'comprehensive_evaluation', {
            evaluationId,
            step: sectionTitle.includes('硬件') ? 'hardware_form' : 'software_form'
        });
        
    } catch (error) {
        console.error(`发送${sectionTitle}失败:`, error);
    }
}

// 最小化评分处理 - 仅UI反馈
async function handleMinimalEvalScoring(userId, data, query) {
    try {
        const parts = data.split('_');
        
        if (parts.length >= 4) {
            const evaluationType = parts[2];
            const score = parseInt(parts[3]);
            const evaluationId = parts[4];
            

            
            // 检查这是否是商家评价 - 如果是则不应该调用这个函数
            try {
                const evaluation = dbOperations.getEvaluation(evaluationId);
                if (evaluation && evaluation.evaluator_type === 'merchant') {
                    console.log(`商家评价${evaluationId}不应该调用handleMinimalEvalScoring，跳过`);
                    return;
                }
            } catch (error) {
                // 静默处理检查失败的情况
            }
            
            // 获取或创建用户状态
            let userState = userEvaluationStates.get(userId);
            if (!userState) {
                userState = { scores: {}, completedCount: 0, messageId: null };
                userEvaluationStates.set(userId, userState);
            }
            
            // 检查是否为新评分
            const wasNew = userState.scores[evaluationType] === undefined;
            
            // 更新评分（仅内存）
            userState.scores[evaluationType] = score;
            
            // 更新计数
            if (wasNew) {
                userState.completedCount++;
            }
            
            // 更新状态
            userEvaluationStates.set(userId, userState);
            
            // 即时UI更新 - 确定是硬件还是软件项目
            const hardwareKeys = ['appearance', 'breasts', 'waist', 'legs', 'feet', 'tightness'];
            const isHardware = hardwareKeys.includes(evaluationType);
            

            await updateEvaluationSection(userId, evaluationId, evaluationType, userState, isHardware);
        }
    } catch (error) {
        // 静默处理错误，不影响用户体验
    }
}

// 更新特定评价板块的函数
async function updateEvaluationSection(userId, evaluationId, evaluationType, userState, isHardware) {
    try {
        // 首先检查这是否是商家评价 - 如果是则直接跳过，因为商家评价不使用这个更新机制
        const evaluation = dbOperations.getEvaluation(evaluationId);

        
        if (evaluation && evaluation.evaluator_type === 'merchant') {
            console.log(`商家评价${evaluationId}不需要UI更新，跳过`);
            return;
        }
        
        if (!evaluation) {
            console.log(`[WARNING] 找不到evaluationId ${evaluationId}的评价记录，跳过更新`);
            return;
        }
        
        // 确定要更新的项目列表和消息ID
        const hardwareItems = [
            { key: 'appearance', name: '颜值' },
            { key: 'breasts', name: '咪咪' },
            { key: 'waist', name: '腰腹' },
            { key: 'legs', name: '腿型' },
            { key: 'feet', name: '脚型' },
            { key: 'tightness', name: '松紧' }
        ];
        
        const softwareItems = [
            { key: 'temperament', name: '气质' },
            { key: 'environment', name: '环境' },
            { key: 'sexiness', name: '骚气' },
            { key: 'attitude', name: '态度' },
            { key: 'voice', name: '叫声' },
            { key: 'initiative', name: '主动' }
        ];
        
        const items = isHardware ? hardwareItems : softwareItems;
        const sectionTitle = isHardware ? '🔧 硬件评价' : '💎 软件评价';
        const headerText = '📋 请根据您的体验进行老师综合评价：\n🫶 这会对老师的数据有帮助\n\n'; // 两条消息都使用相同的说明文字
        const messageId = isHardware ? userState.messageId : userState.softwareMessageId;
        
        if (!messageId) {
            console.log(`未找到${sectionTitle}的消息ID，跳过更新`);
            
            // 检查评价是否已经完成，如果完成则静默跳过
            try {
                if (evaluation && evaluation.status === 'completed') {
                    console.log(`✅ 评价${evaluationId}已完成，跳过UI更新`);
                    return;
                }
            } catch (error) {
                // 静默处理检查失败的情况
            }
            
            return;
        }
        
        // 构建消息文本
        const message = `${headerText}${sectionTitle}：

💡 点击下方按钮评分（1-10分）：`;
        
        // 构建键盘布局
        const keyboard = {
            inline_keyboard: []
        };
        
        // 为每个评价项目创建三行布局
        items.forEach(item => {
            const currentScore = userState.scores[item.key];
            
            // 标题行
            const titleRow = [{
                text: currentScore ? `${item.name} ✅${currentScore}分` : `${item.name} (未评分)`,
                callback_data: `eval_info_${item.key}`
            }];
            keyboard.inline_keyboard.push(titleRow);
            
            // 1-5分行
            const scoreRow1 = [];
            for (let i = 1; i <= 5; i++) {
                scoreRow1.push({
                    text: currentScore === i ? `✅${i}` : `${i}`,
                    callback_data: `eval_score_${item.key}_${i}_${evaluationId}`
                });
            }
            keyboard.inline_keyboard.push(scoreRow1);
            
            // 6-10分行
            const scoreRow2 = [];
            for (let i = 6; i <= 10; i++) {
                scoreRow2.push({
                    text: currentScore === i ? `✅${i}` : `${i}`,
                    callback_data: `eval_score_${item.key}_${i}_${evaluationId}`
                });
            }
            keyboard.inline_keyboard.push(scoreRow2);
        });
        
        // 在软件评价消息中添加提交和返回按钮
        if (!isHardware) {
            if (userState.completedCount === 12) {
                keyboard.inline_keyboard.push([
                    { text: '🎉 提交完整评价', callback_data: `eval_submit_${evaluationId}` }
                ]);
            } else {
                keyboard.inline_keyboard.push([
                    { text: `⏳ 请完成所有评价 (${userState.completedCount}/12)`, callback_data: 'eval_incomplete' }
                ]);
            }
            
            keyboard.inline_keyboard.push([
                { text: '⬅️ 返回', callback_data: `back_user_eval_${evaluationId}` }
            ]);
        }
        
        // 编辑消息 - 增加错误处理
        await bot.editMessageText(message, {
            chat_id: userId,
            message_id: messageId,
            reply_markup: keyboard
        });
        
    } catch (error) {
        // 如果是"消息未修改"错误，静默处理（这是正常情况）
        if (error.message.includes('message is not modified')) {
            console.log(`✅ ${isHardware ? '硬件' : '软件'}评价消息无需更新（内容相同）`);
        } else {
            console.log(`更新${isHardware ? '硬件' : '软件'}评价消息失败:`, error.message);
        }
    }
}

// 处理用户评分 - 仅UI更新版本
async function handleUserScoringUIOnly(userId, data, query) {
    try {
        const parts = data.split('_');
        
        // 新格式: eval_score_type_X_evaluationId
        if (data.startsWith('eval_score_')) {
            const evaluationType = parts[2]; // appearance, tightness, etc.
            const score = parseInt(parts[3]);
            const evaluationId = parts[4];
            
            // 更新用户评价状态 - 仅内存操作
            let userState = userEvaluationStates.get(userId);
            if (!userState) {
                // 如果状态不存在，创建新状态
                userState = { scores: {}, completedCount: 0, messageId: null };
                userEvaluationStates.set(userId, userState);
            }
            
            // 检查是否是新评分
            const wasNew = userState.scores[evaluationType] === undefined;
            
            // 保存评分到内存
            userState.scores[evaluationType] = score;
            
            // 更新完成计数
            if (wasNew) {
                userState.completedCount++;
            }
            
            // 更新状态
            userEvaluationStates.set(userId, userState);
            
            // 仅更新UI，不进行数据库操作
            await sendComprehensiveEvaluationForm(userId, evaluationId, userState.messageId);
            
            console.log(`✅ 纯UI更新完成: ${evaluationType}=${score}, 进度${userState.completedCount}/12`);
        }
        
    } catch (error) {
        console.error('纯UI评分更新失败:', error);
    }
}

// 处理用户评分
async function handleUserScoring(userId, data, query) {
    try {

        const parts = data.split('_');
        
        // 判断数据格式
        if (data.startsWith('eval_score_')) {
            // 新格式: eval_score_type_X_evaluationId
            const evaluationType = parts[2]; // appearance, tightness, etc.
            const score = parseInt(parts[3]);
            const evaluationId = parts[4];
            
            // 更新用户评价状态
            let userState = userEvaluationStates.get(userId);
            if (!userState) {
                console.error('用户评价状态丢失');
                return;
            }
            
            // 检查是否是新评分
            const wasNew = userState.scores[evaluationType] === undefined;
            
            // 保存评分
            userState.scores[evaluationType] = score;
            
            // 更新完成计数
            if (wasNew) {
                userState.completedCount++;
            }
            
            // 更新状态
            userEvaluationStates.set(userId, userState);
            
            // 注意：这里不再立即更新数据库，只在最终提交时才写入
            // 中间步骤只更新内存状态，提升用户体验
            
            // 编辑当前消息，不发送新消息
            await sendComprehensiveEvaluationForm(userId, evaluationId, userState.messageId);
            
        } else if (data.startsWith('user_eval_')) {
            // 兼容旧格式: user_eval_type_X_evaluationId
            const evaluationType = parts[2]; // appearance, tightness, etc.
            const score = parseInt(parts[3]);
            const evaluationId = parts[4];
            
            // 获取评价会话
            const evalSession = dbOperations.getEvaluationSession(userId, evaluationId);
            if (!evalSession) return;
            
            let tempData = {};
            try {
                tempData = JSON.parse(evalSession.temp_data || '{}');
            } catch (e) {
                tempData = {};
            }
            
            // 保存当前评分
            tempData[evaluationType] = score;
            
            // 定义评价流程顺序
            const hardwareSteps = ['appearance', 'tightness', 'feet', 'legs', 'waist', 'breasts'];
            const softwareSteps = ['temperament', 'environment', 'sexiness', 'attitude', 'voice', 'initiative'];
            
            let nextStep = null;
            let nextMessage = '';
            let nextKeyboard = null;
            
            // 确定下一步
            if (hardwareSteps.includes(evaluationType)) {
                const currentIndex = hardwareSteps.indexOf(evaluationType);
                if (currentIndex < hardwareSteps.length - 1) {
                    // 继续硬件评价
                    nextStep = hardwareSteps[currentIndex + 1];
                    nextMessage = getHardwareMessage(nextStep);
                    nextKeyboard = getScoreKeyboard(nextStep, evaluationId);
                } else {
                    // 硬件评价完成，开始软件评价
                    nextStep = softwareSteps[0];
                    nextMessage = getSoftwareMessage(nextStep);
                    nextKeyboard = getScoreKeyboard(nextStep, evaluationId);
                }
            } else if (softwareSteps.includes(evaluationType)) {
                const currentIndex = softwareSteps.indexOf(evaluationType);
                if (currentIndex < softwareSteps.length - 1) {
                    // 继续软件评价
                    nextStep = softwareSteps[currentIndex + 1];
                    nextMessage = getSoftwareMessage(nextStep);
                    nextKeyboard = getScoreKeyboard(nextStep, evaluationId);
                } else {
                    // 所有评价完成，进入用户文字评价环节
                    dbOperations.updateEvaluationSession(evalSession.id, 'user_text_comment', tempData);
                    showUserTextCommentStep(userId, evaluationId, tempData);
                    return;
                }
            }
            
            // 更新评价会话
            dbOperations.updateEvaluationSession(evalSession.id, nextStep, tempData);
            
            // 发送下一个评价项目
            if (nextMessage && nextKeyboard) {
                await sendMessageWithDelete(userId, nextMessage, { 
                    reply_markup: nextKeyboard 
                }, 'user_evaluation', {
                    evaluationId,
                    step: nextStep
                });
            }
        }
        
    } catch (error) {
        console.error('处理用户评分失败:', error);
    }
}

// 处理无效按钮点击
async function handleInvalidEvaluationClick(userId, data, query) {
    try {
        if (data === 'eval_incomplete') {
            await bot.answerCallbackQuery(query.id, {
                text: '请完成所有12项评价后再提交！',
                show_alert: true
            });
        } else if (data.startsWith('eval_info_')) {
            await bot.answerCallbackQuery(query.id, {
                text: '请点击右侧数字按钮进行评分',
                show_alert: false
            });
        }
    } catch (error) {
        console.error('处理无效评价点击失败:', error);
    }
}

// 处理评价提交
async function handleEvaluationSubmit(userId, data, query) {
    try {
        const evaluationId = data.replace('eval_submit_', '');
        const userState = userEvaluationStates.get(userId);
        
        if (!userState || userState.completedCount < 12) {
            await bot.sendMessage(userId, '请完成所有12项评价后再提交！');
            return;
        }
        
        // 先保存12项评价数据到数据库
        const scores = userState.scores;
        dbOperations.updateEvaluation(evaluationId, null, scores, null, 'completed');
        console.log(`📝 12项评价数据已保存到数据库: ${evaluationId}`, scores);
        
        // 删除评价消息
        if (userState.messageId) {
            try {
                await bot.deleteMessage(userId, userState.messageId);
                console.log(`🗑️ 已删除硬件评价消息: ${userState.messageId}`);
            } catch (error) {
                console.log('删除硬件评价消息失败:', error.message);
            }
        }
        
        if (userState.softwareMessageId) {
            try {
                await bot.deleteMessage(userId, userState.softwareMessageId);
                console.log(`🗑️ 已删除软件评价消息: ${userState.softwareMessageId}`);
            } catch (error) {
                console.log('删除软件评价消息失败:', error.message);
            }
        }
        
        // 显示用户文字评价步骤
        await showUserTextCommentStep(userId, evaluationId, userState.scores);
        
    } catch (error) {
        console.error('处理评价提交失败:', error);
    }
}

// 获取硬件评价消息
function getHardwareMessage(step) {
    const messages = {
        'appearance': '硬件评价\n\n颜值：',
        'tightness': '松紧：',
        'feet': '脚型：',
        'legs': '腿型：',
        'waist': '腰腹：',
        'breasts': '咪咪：'
    };
    return messages[step] || '评价：';
}

// 获取软件评价消息
function getSoftwareMessage(step) {
    const messages = {
        'temperament': '软件评价\n\n气质：',
        'environment': '环境：',
        'sexiness': '骚气：',
        'attitude': '态度：',
        'voice': '叫声：',
        'initiative': '主动：'
    };
    return messages[step] || '评价：';
}

// 获取评分键盘
function getScoreKeyboard(step, evaluationId) {
    return {
        inline_keyboard: [
            [
                { text: '0', callback_data: `user_eval_${step}_0_${evaluationId}` },
                { text: '1', callback_data: `user_eval_${step}_1_${evaluationId}` },
                { text: '2', callback_data: `user_eval_${step}_2_${evaluationId}` },
                { text: '3', callback_data: `user_eval_${step}_3_${evaluationId}` },
                { text: '4', callback_data: `user_eval_${step}_4_${evaluationId}` }
            ],
            [
                { text: '5', callback_data: `user_eval_${step}_5_${evaluationId}` },
                { text: '6', callback_data: `user_eval_${step}_6_${evaluationId}` },
                { text: '7', callback_data: `user_eval_${step}_7_${evaluationId}` },
                { text: '8', callback_data: `user_eval_${step}_8_${evaluationId}` },
                { text: '9', callback_data: `user_eval_${step}_9_${evaluationId}` },
                { text: '10', callback_data: `user_eval_${step}_10_${evaluationId}` }
            ],
            [
                { text: '⬅️ 返回', callback_data: `back_user_eval_${evaluationId}` }
            ]
        ]
    };
}

// 显示用户文字评价步骤
async function showUserTextCommentStep(userId, evaluationId, scores) {
    try {
        const message = `✅ 您的12项评价已提交成功！

额外点评（额外输入文字点评，任何都行）：

请输入您的额外点评，或直接点击按钮完成。`;
        
        const keyboard = {
            inline_keyboard: [
                [
                    { text: '跳过文字评价📋', callback_data: `user_text_skip_${evaluationId}` }
                ],
                [
                    { text: '提交文字报告📝', callback_data: `user_text_submit_${evaluationId}` }
                ]
            ]
        };
        
        await sendMessageWithoutDelete(userId, message, { 
            reply_markup: keyboard 
        }, 'user_text_comment', {
            evaluationId,
            scores
        });
        
    } catch (error) {
        console.error('显示用户文字评价步骤失败:', error);
    }
}

// 显示评价总结
async function showEvaluationSummary(userId, evaluationId, scores) {
    try {
        let summary = `评价完成，请确认评分结果：

硬件评价
颜值：${String(scores.appearance || 0).padStart(2, ' ')}分  松紧：${String(scores.tightness || 0).padStart(2, ' ')}分
脚型：${String(scores.feet || 0).padStart(2, ' ')}分  腿型：${String(scores.legs || 0).padStart(2, ' ')}分  
腰腹：${String(scores.waist || 0).padStart(2, ' ')}分  咪咪：${String(scores.breasts || 0).padStart(2, ' ')}分

软件评价  
气质：${String(scores.temperament || 0).padStart(2, ' ')}分  环境：${String(scores.environment || 0).padStart(2, ' ')}分
骚气：${String(scores.sexiness || 0).padStart(2, ' ')}分  态度：${String(scores.attitude || 0).padStart(2, ' ')}分
叫声：${String(scores.voice || 0).padStart(2, ' ')}分  主动：${String(scores.initiative || 0).padStart(2, ' ')}分`;

        // 如果有文字评价，添加到总结中
        if (scores.textComment) {
            summary += `

文字评价：
"${scores.textComment}"`;
        }

        summary += `

请点击下方按钮提交你的最终评价。`;

        const keyboard = {
            inline_keyboard: [
                [
                    { text: '✅ 确认提交', callback_data: `user_eval_confirm_${evaluationId}` },
                    { text: '✏️ 重新评价', callback_data: `user_eval_restart_${evaluationId}` }
                ],
                [
                    { text: '⬅️ 返回修改', callback_data: `back_user_eval_${evaluationId}` }
                ]
            ]
        };
        
        await sendMessageWithoutDelete(userId, summary, { 
            reply_markup: keyboard 
        }, 'user_evaluation_summary', {
            evaluationId,
            scores
        });
        
    } catch (error) {
        console.error('显示评价总结失败:', error);
    }
}

// 处理用户评价确认
async function handleUserEvaluationConfirm(userId, data, query) {
    try {
        const evaluationId = data.replace('user_eval_confirm_', '');
        const userState = userEvaluationStates.get(userId);
        
        if (userState && userState.scores) {
            // 从内存中获取完整评分数据，而不是从数据库session
            const scores = userState.scores;
            
            // 确保所有评分都存在
            if (Object.keys(scores).length < 12) {
                await bot.sendMessage(userId, '评价数据不完整，请重新评价！');
                return;
            }
            
            // 检查是否有文字评价
            const textComment = scores.textComment || null;
            
            // 保存到新的evaluations表
            dbOperations.updateEvaluation(evaluationId, null, scores, textComment, 'completed');
            console.log(`📝 评价数据已保存到evaluations表: ${evaluationId}`, scores);
            
            // 兼容性：同时更新orders表中的用户评价字段
            const evaluation = dbOperations.getEvaluation(evaluationId);
            if (evaluation && evaluation.booking_session_id) {
                const order = dbOperations.getOrderByBookingSession(evaluation.booking_session_id);
                if (order) {
                    const evaluationData = JSON.stringify({
                        scores: scores,
                        textComment: textComment,
                        created_at: Math.floor(Date.now() / 1000)
                    });
                    dbOperations.updateOrderFields(order.id, {
                        user_evaluation: evaluationData,
                        updated_at: Math.floor(Date.now() / 1000)
                    });
                    console.log(`📝 兼容性：用户评价数据已同步到orders表，订单ID: ${order.id}`);
                }
            }
            
            if (textComment) {
                console.log(`📝 用户文字评价: "${textComment}"`);
            }
            
            // 删除评价消息（如果存在messageId）- 删除两条消息
            if (userState.messageId) {
                try {
                    await bot.deleteMessage(userId, userState.messageId);
                    console.log(`🗑️ 已删除硬件评价消息: ${userState.messageId}`);
                } catch (error) {
                    console.log('删除硬件评价消息失败:', error.message);
                }
            }
            
            if (userState.softwareMessageId) {
                try {
                    await bot.deleteMessage(userId, userState.softwareMessageId);
                    console.log(`🗑️ 已删除软件评价消息: ${userState.softwareMessageId}`);
                } catch (error) {
                    console.log('删除软件评价消息失败:', error.message);
                }
            }
            
            // 清理内存状态
            userEvaluationStates.delete(userId);
            
            // 确保进入播报选择阶段
            console.log(`✅ 用户评价完成，进入播报选择阶段: userId=${userId}, evaluationId=${evaluationId}`);
            await showBroadcastChoice(userId, evaluationId);
        }
        
    } catch (error) {
        console.error('处理用户评价确认失败:', error);
    }
}

// 处理用户评价重新开始
async function handleUserEvaluationRestart(userId, data, query) {
    try {
        const evaluationId = data.replace('user_eval_restart_', '');
        const evaluation = dbOperations.getEvaluation(evaluationId);
        
        if (evaluation) {
            // 重新开始评价流程
            const sessionId = dbOperations.createEvaluationSession(userId, evaluationId);
            
            // 开始硬件评价 - 颜值
            const message = `硬件评价\n\n颜值：`;
            const keyboard = getScoreKeyboard('appearance', evaluationId);
            
            await sendMessageWithoutDelete(userId, message, { 
                reply_markup: keyboard 
            }, 'user_evaluation', {
                evaluationId,
                step: 'appearance'
            });
            
            // 更新评价会话状态
            dbOperations.updateEvaluationSession(sessionId, 'hardware_appearance', {});
        }
        
    } catch (error) {
        console.error('处理用户评价重新开始失败:', error);
    }
}

// 处理商家详细评价文字输入
async function handleMerchantDetailCommentInput(userId, text, evalSession) {
    try {
        console.log(`=== 商家详细评价文字输入调试 ===`);
        console.log(`用户 ${userId} 输入文字评价: "${text}"`);
        console.log(`评价会话ID: ${evalSession.id}`);
        
        // 获取评价ID
        const evaluationId = evalSession.evaluation_id;
        
        // 获取当前评分数据
        let tempData = {};
        try {
            tempData = JSON.parse(evalSession.temp_data || '{}');
        } catch (e) {
            tempData = {};
        }
        
        // 保存文字评价
        tempData.textComment = text;
        
        console.log(`保存商家文字评价: "${text}"`);
        console.log(`更新后的tempData:`, tempData);
        
        // 获取现有评价，保留overall_score
        const existingEvaluation = evaluationService.getEvaluation(evaluationId);
        const existingOverallScore = existingEvaluation ? existingEvaluation.overall_score : null;
        
        // 提交评价到新的evaluations表
        evaluationService.updateEvaluation(evaluationId, existingOverallScore, tempData, text, 'completed');
        
        // 兼容性：同时更新orders表中的商家评价字段
        const evaluation = evaluationService.getEvaluation(evaluationId);
        if (evaluation && evaluation.booking_session_id) {
            const order = dbOperations.getOrderByBookingSession(evaluation.booking_session_id);
            if (order) {
                const evaluationData = JSON.stringify({
                    overall_score: existingOverallScore,
                    scores: tempData,
                    textComment: text,
                    created_at: Math.floor(Date.now() / 1000)
                });
                dbOperations.updateOrderFields(order.id, {
                    merchant_evaluation: evaluationData,
                    updated_at: Math.floor(Date.now() / 1000)
                });
                console.log(`📝 兼容性：商家评价数据已同步到orders表，订单ID: ${order.id}`);
            }
        }
        
        // 删除之前的评价请求消息（包含"跳过文字评价"按钮的消息）
        try {
            await clearUserConversation(userId);
        } catch (error) {
            console.log('清理商家评价消息失败:', error);
        }
        
        // 删除评价会话
        dbOperations.deleteEvaluationSession(evalSession.id);
        
        // 发送完成消息
        await bot.sendMessage(userId, '🎉 详细评价提交成功！\n\n🙏 感谢老师您耐心评价，这将会纳入您的评价数据\n📊 未来小鸡会总结您的全面总结上课报告数据！');
        
        // 商家详细评价完成后，直接结束流程（商家不需要播报）
        setTimeout(async () => {
            await bot.sendMessage(userId, '欢迎下次为小鸡服务！');
        }, 1000);
        
        console.log(`=== 商家详细评价文字输入调试结束 ===`);
        
    } catch (error) {
        console.error('处理商家详细评价文字输入失败:', error);
        await bot.sendMessage(userId, '文字评价保存失败，请重试。');
    }
}

// 处理用户文字评价输入
async function handleUserTextCommentInput(userId, text, evalSession) {
    try {
        console.log(`=== 用户文字评价输入调试 ===`);
        console.log(`用户 ${userId} 输入文字评价: "${text}"`);
        
        // 获取用户状态（优先使用内存状态，新系统）
        let userState = userEvaluationStates.get(userId);
        let evaluationId;
        let scores;
        
        if (userState) {
            // 新系统：使用内存状态
            console.log(`使用新系统内存状态`);
            evaluationId = userState.evaluationId;
            scores = userState.scores;
            
            // 保存文字评价到内存状态
            scores.textComment = text;
            userEvaluationStates.set(userId, userState);
            
        } else {
            // 旧系统：使用数据库会话
            console.log(`使用旧系统数据库会话，会话ID: ${evalSession.id}`);
            evaluationId = evalSession.evaluation_id;
            
            // 获取当前评分数据
            let tempData = {};
            try {
                tempData = JSON.parse(evalSession.temp_data || '{}');
            } catch (e) {
                tempData = {};
            }
            
            // 保存文字评价
            tempData.textComment = text;
            scores = tempData;
            
            // 更新评价会话为总结状态
            dbOperations.updateEvaluationSession(evalSession.id, 'evaluation_summary', tempData);
        }
        
        console.log(`保存文字评价: "${text}"`);
        console.log(`更新后的scores:`, scores);
        
        // 删除之前的评价请求消息（包含"跳过文字评价"按钮的消息）
        try {
            await clearUserConversation(userId);
        } catch (error) {
            console.log('清理用户评价消息失败:', error);
        }
        
        // 更新数据库中的文字评价
        if (userState) {
            // 新系统：更新数据库评价记录
            dbOperations.updateEvaluation(evaluationId, null, scores, text, 'completed');
            console.log(`📝 文字评价已更新到数据库: "${text}"`);
        }
        
        // 确保进入播报选择阶段
        console.log(`✅ 用户文字评价完成，进入播报选择阶段: userId=${userId}, evaluationId=${evaluationId}`);
        await showBroadcastChoice(userId, evaluationId);
        
        console.log(`=== 用户文字评价输入调试结束 ===`);
        
    } catch (error) {
        console.error('处理用户文字评价输入失败:', error);
        await sendMessageWithoutDelete(userId, '文字评价保存失败，请重试。', {}, 'text_comment_error');
    }
}

// 处理用户文字评价
async function handleUserTextComment(userId, data, query) {
    try {
        if (data.startsWith('user_text_skip_')) {
            // 跳过文字评价，进入播报选择
            const evaluationId = data.replace('user_text_skip_', '');
            console.log(`✅ 用户${userId}跳过文字评价，进入播报选择阶段: evaluationId=${evaluationId}`);
            
            // 确保进入播报选择阶段
            await showBroadcastChoice(userId, evaluationId);
            
        } else if (data.startsWith('user_text_submit_')) {
            // 提交文字报告
            const evaluationId = data.replace('user_text_submit_', '');
            
            // 检查用户是否有内存状态和文字评价
            const userState = userEvaluationStates.get(userId);
            if (userState && userState.scores && userState.scores.textComment) {
                // 用户有文字评价，提交并进入播报选择
                console.log(`用户${userId}提交文字报告: "${userState.scores.textComment}"`);
                
                // 更新数据库中的文字评价
                dbOperations.updateEvaluation(evaluationId, null, userState.scores, userState.scores.textComment, 'completed');
                console.log(`📝 文字评价已更新到数据库: "${userState.scores.textComment}"`);
                
                // 确保进入播报选择阶段
                console.log(`✅ 用户${userId}提交文字报告完成，进入播报选择阶段: evaluationId=${evaluationId}`);
                await showBroadcastChoice(userId, evaluationId);
            } else {
                // 用户还没有输入文字内容
                console.log(`用户${userId}点击提交文字报告，但没有输入文字内容`);
                
                // 提示用户需要输入文字内容
                await bot.answerCallbackQuery(query.id, {
                    text: '请先输入您的文字评价内容，然后再点击提交',
                    show_alert: true
                });
            }
        }
        
    } catch (error) {
        console.error('处理用户文字评价失败:', error);
    }
}

// 处理用户评价返回
async function handleUserEvaluationBack(userId, data, query) {
    try {
        console.log(`handleUserEvaluationBack被调用: userId=${userId}, data=${data}`);
        
        // 提取evaluationId
        const evaluationId = data.split('_').pop();
        console.log(`提取的evaluationId: ${evaluationId}`);
        
        // 获取评价会话
        const evalSession = dbOperations.getEvaluationSession(userId, evaluationId);
        if (!evalSession) {
            console.log(`评价会话不存在: userId=${userId}, evaluationId=${evaluationId}`);
            await sendMessageWithDelete(userId, '评价会话已失效，请重新开始评价。', {}, 'evaluation_expired');
            return;
        }
        
        // 根据当前步骤返回到上一步
        const currentStep = evalSession.current_step;
        console.log(`当前评价步骤: ${currentStep}`);
        
        // 如果当前在评价总结页面，返回到文字评价步骤
        if (currentStep === 'evaluation_summary') {
            const tempData = JSON.parse(evalSession.temp_data || '{}');
            
            // 返回到用户文字评价步骤
            dbOperations.updateEvaluationSession(evalSession.id, 'user_text_comment', evalSession.temp_data);
            await showUserTextCommentStep(userId, evaluationId, tempData);
            return;
        }
        
        // 如果当前在文字评价页面，返回到最后一个评价项目
        if (currentStep === 'user_text_comment') {
            const tempData = JSON.parse(evalSession.temp_data || '{}');
            const lastStep = 'initiative'; // 最后一个评价项目
            const lastMessage = getSoftwareMessage(lastStep);
            const lastKeyboard = getScoreKeyboard(lastStep, evaluationId);
            
            // 更新评价会话到最后一个评价步骤
            dbOperations.updateEvaluationSession(evalSession.id, 'software_initiative', evalSession.temp_data);
            
            await sendMessageWithoutDelete(userId, lastMessage, { 
                reply_markup: lastKeyboard 
            }, 'user_evaluation', {
                evaluationId,
                step: lastStep
            });
            return;
        }
        
        // 定义评价流程顺序
        const hardwareSteps = ['hardware_appearance', 'hardware_tightness', 'hardware_feet', 'hardware_legs', 'hardware_waist', 'hardware_breasts'];
        const softwareSteps = ['software_temperament', 'software_environment', 'software_sexiness', 'software_attitude', 'software_voice', 'software_initiative'];
        const allSteps = [...hardwareSteps, ...softwareSteps];
        
        const currentIndex = allSteps.indexOf(currentStep);
        
        if (currentIndex > 0) {
            // 返回到上一个评价步骤
            const prevStep = allSteps[currentIndex - 1];
            const stepName = prevStep.replace('hardware_', '').replace('software_', '');
            
            let prevMessage;
            if (hardwareSteps.includes(prevStep)) {
                prevMessage = getHardwareMessage(stepName);
            } else {
                prevMessage = getSoftwareMessage(stepName);
            }
            
            const prevKeyboard = getScoreKeyboard(stepName, evaluationId);
            
            // 更新评价会话到上一步
            dbOperations.updateEvaluationSession(evalSession.id, prevStep, evalSession.temp_data);
            
            await sendMessageWithoutDelete(userId, prevMessage, { 
                reply_markup: prevKeyboard 
            }, 'user_evaluation', {
                evaluationId,
                step: stepName
            });
            
        } else {
            // 如果是第一步，返回到课程完成确认
            const evaluation = dbOperations.getEvaluation(evaluationId);
            if (evaluation) {
                const bookingSession = dbOperations.getBookingSession(evaluation.booking_session_id);
                if (bookingSession) {
                    await handleBackToCourseCompletion(userId, bookingSession.id);
                }
            }
        }
        
    } catch (error) {
        console.error('处理用户评价返回失败:', error);
        await sendMessageWithDelete(userId, '返回操作失败，请重新开始评价。', {}, 'back_error');
    }
}

// 处理商家评价确认
async function handleMerchantEvaluationConfirm(userId, data, query) {
    try {
        if (data.startsWith('eval_confirm_')) {
            const parts = data.split('_');
            const score = parseInt(parts[2]);
            const evaluationId = parts[3];
            
            console.log('=== 商家评价确认调试 ===');
            console.log('callback_data:', data);
            console.log('解析parts:', parts);
            console.log('解析score:', score, typeof score);
            console.log('解析evaluationId:', evaluationId);
            
            // 保存评分到新的evaluations表
            console.log('调用updateEvaluation保存总体评分');
            try {
                const result = evaluationService.updateEvaluation(evaluationId, score, null, null, 'overall_completed');
                console.log('updateEvaluation执行结果:', result);
                
                // 验证保存是否成功
                const savedEval = evaluationService.getEvaluation(evaluationId);
                console.log('保存后的评价数据:', savedEval);
                
                // 兼容性：同时更新orders表中的商家评价字段
                if (savedEval && savedEval.booking_session_id) {
                    const order = dbOperations.getOrderByBookingSession(savedEval.booking_session_id);
                    if (order) {
                        const evaluationData = JSON.stringify({
                            overall_score: score,
                            scores: {},
                            textComment: null,
                            created_at: Math.floor(Date.now() / 1000)
                        });
                        dbOperations.updateOrderFields(order.id, {
                            merchant_evaluation: evaluationData,
                            updated_at: Math.floor(Date.now() / 1000)
                        });
                        console.log(`📝 兼容性：商家总体评分已同步到orders表，订单ID: ${order.id}`);
                    }
                }
                
            } catch (error) {
                console.error('保存总体评分失败:', error);
                bot.sendMessage(userId, '保存评分失败，请重试');
                return;
            }
            console.log('=== 商家评价确认调试结束 ===');
            
            // 询问是否进行详细评价
            const message = `是否进行详细评价？`;
            const keyboard = {
                inline_keyboard: [
                    [
                        { text: '确认✅', callback_data: `merchant_detail_eval_start_${evaluationId}` },
                        { text: '不了👋', callback_data: `merchant_detail_eval_no_${evaluationId}` }
                    ],
                    [
                        { text: '⬅️ 返回', callback_data: `back_merchant_detail_confirm_${evaluationId}` }
                    ]
                ]
            };
            
            await sendMessageWithDelete(userId, message, { 
                reply_markup: keyboard 
            }, 'merchant_detail_confirm', {
                evaluationId,
                score
            });
            
        } else if (data.startsWith('eval_modify_')) {
            const evaluationId = data.replace('eval_modify_', '');
            
            // 重新显示评分选项
            const message = `出击总体素质：`;
            const keyboard = {
                inline_keyboard: [
                    [
                        { text: '1', callback_data: `eval_score_1_${evaluationId}` },
                        { text: '2', callback_data: `eval_score_2_${evaluationId}` },
                        { text: '3', callback_data: `eval_score_3_${evaluationId}` },
                        { text: '4', callback_data: `eval_score_4_${evaluationId}` },
                        { text: '5', callback_data: `eval_score_5_${evaluationId}` }
                    ],
                    [
                        { text: '6', callback_data: `eval_score_6_${evaluationId}` },
                        { text: '7', callback_data: `eval_score_7_${evaluationId}` },
                        { text: '8', callback_data: `eval_score_8_${evaluationId}` },
                        { text: '9', callback_data: `eval_score_9_${evaluationId}` },
                        { text: '10', callback_data: `eval_score_10_${evaluationId}` }
                    ],
                    [
                        { text: '⬅️ 返回', callback_data: `back_merchant_evaluation_modify_${evaluationId}` }
                    ]
                ]
            };
            
            await sendMessageWithDelete(userId, message, { 
                reply_markup: keyboard 
            }, 'merchant_evaluation_modify', {
                evaluationId
            });
        }
        
    } catch (error) {
        console.error('处理商家评价确认失败:', error);
    }
}

// 处理详细评价
async function handleDetailedEvaluation(userId, data, query) {
    try {
        if (data.startsWith('detailed_eval_no_')) {
            const evaluationId = data.replace('detailed_eval_no_', '');
            
            // 保存评价状态为完成
            dbOperations.updateEvaluation(evaluationId, null, null, null, 'completed');
            
            await sendMessageWithDelete(userId, '感谢您的支持。欢迎下次使用。', {}, 'evaluation_complete');
            
        } else if (data.startsWith('detailed_eval_yes_')) {
            const evaluationId = data.replace('detailed_eval_yes_', '');
            
            // 创建详细评价会话
            const sessionId = dbOperations.createEvaluationSession(userId, evaluationId);
            
            // 开始详细评价流程 - 第一项：鸡鸡长度
            const message = `详细评价\n\n鸡鸡长度：`;
            const keyboard = {
                inline_keyboard: [
                    [
                        { text: '1', callback_data: `detail_length_1_${evaluationId}` },
                        { text: '2', callback_data: `detail_length_2_${evaluationId}` },
                        { text: '3', callback_data: `detail_length_3_${evaluationId}` },
                        { text: '4', callback_data: `detail_length_4_${evaluationId}` },
                        { text: '5', callback_data: `detail_length_5_${evaluationId}` }
                    ],
                    [
                        { text: '6', callback_data: `detail_length_6_${evaluationId}` },
                        { text: '7', callback_data: `detail_length_7_${evaluationId}` },
                        { text: '8', callback_data: `detail_length_8_${evaluationId}` },
                        { text: '9', callback_data: `detail_length_9_${evaluationId}` },
                        { text: '10', callback_data: `detail_length_10_${evaluationId}` }
                    ],
                    [
                        { text: '⬅️ 返回', callback_data: `back_detailed_evaluation_${evaluationId}` }
                    ]
                ]
            };
            
            await sendMessageWithDelete(userId, message, { 
                reply_markup: keyboard 
            }, 'detailed_evaluation', {
                evaluationId,
                step: 'length'
            });
            
            // 更新评价会话状态
            dbOperations.updateEvaluationSession(sessionId, 'detail_length', {});
        }
        
    } catch (error) {
        console.error('处理详细评价失败:', error);
    }
}

// 处理详细评价评分
async function handleDetailedEvaluationScoring(userId, data, query) {
    try {
        const parts = data.split('_');
        const evaluationType = parts[1]; // length, thickness, durability, technique
        const score = parseInt(parts[2]);
        const evaluationId = parts[3];
        
        // 获取评价会话
        const evalSession = dbOperations.getEvaluationSession(userId, evaluationId);
        if (!evalSession) {
            bot.sendMessage(userId, '评价会话已失效，请重新开始评价。');
            return;
        }
        
        let tempData = {};
        try {
            tempData = JSON.parse(evalSession.temp_data || '{}');
        } catch (e) {
            tempData = {};
        }
        
        // 保存当前评分
        tempData[evaluationType] = score;
        
        // 定义详细评价流程顺序
        const detailSteps = ['length', 'thickness', 'durability', 'technique'];
        const currentIndex = detailSteps.indexOf(evaluationType);
        
        if (currentIndex < detailSteps.length - 1) {
            // 继续下一个详细评价项目
            const nextStep = detailSteps[currentIndex + 1];
            const nextMessage = getDetailedEvaluationMessage(nextStep);
            const nextKeyboard = getDetailedEvaluationKeyboard(nextStep, evaluationId);
            
            // 更新评价会话
            dbOperations.updateEvaluationSession(evalSession.id, `detail_${nextStep}`, tempData);
            
            // 发送下一个评价项目
            await sendMessageWithDelete(userId, nextMessage, { 
                reply_markup: nextKeyboard 
            }, 'detailed_evaluation', {
                evaluationId,
                step: nextStep
            });
            
        } else {
            // 所有详细评价完成，显示确认页面
            showDetailedEvaluationSummary(userId, evaluationId, tempData);
        }
        
    } catch (error) {
        console.error('处理详细评价评分失败:', error);
    }
}

// 获取详细评价消息
function getDetailedEvaluationMessage(step) {
    const messages = {
        'length': '详细评价\n\n鸡鸡长度：',
        'thickness': '鸡鸡粗度：',
        'durability': '持久度：',
        'technique': '技巧：'
    };
    return messages[step] || '评价：';
}

// 获取详细评价键盘
function getDetailedEvaluationKeyboard(step, evaluationId) {
    return {
        inline_keyboard: [
            [
                { text: '1', callback_data: `detail_${step}_1_${evaluationId}` },
                { text: '2', callback_data: `detail_${step}_2_${evaluationId}` },
                { text: '3', callback_data: `detail_${step}_3_${evaluationId}` },
                { text: '4', callback_data: `detail_${step}_4_${evaluationId}` },
                { text: '5', callback_data: `detail_${step}_5_${evaluationId}` }
            ],
            [
                { text: '6', callback_data: `detail_${step}_6_${evaluationId}` },
                { text: '7', callback_data: `detail_${step}_7_${evaluationId}` },
                { text: '8', callback_data: `detail_${step}_8_${evaluationId}` },
                { text: '9', callback_data: `detail_${step}_9_${evaluationId}` },
                { text: '10', callback_data: `detail_${step}_10_${evaluationId}` }
            ],
            [
                { text: '⬅️ 返回', callback_data: `back_detail_eval_${evaluationId}` }
            ]
        ]
    };
}

// 显示详细评价总结
async function showDetailedEvaluationSummary(userId, evaluationId, scores) {
    try {
        const summary = `详细评价确认

鸡鸡长度：${scores.length || 0}分
鸡鸡粗度：${scores.thickness || 0}分
持久度：${scores.durability || 0}分
技巧：${scores.technique || 0}分

是否确认提交详细评价？`;

        const keyboard = {
            inline_keyboard: [
                [
                    { text: '确认提交✅', callback_data: `detail_confirm_${evaluationId}` },
                    { text: '重新评价✍️', callback_data: `detail_restart_${evaluationId}` }
                ],
                [
                    { text: '⬅️ 返回', callback_data: `back_detail_eval_summary_${evaluationId}` }
                ]
            ]
        };
        
        await sendMessageWithDelete(userId, summary, { 
            reply_markup: keyboard 
        }, 'detailed_evaluation_summary', {
            evaluationId,
            scores
        });
        
    } catch (error) {
        console.error('显示详细评价总结失败:', error);
    }
}

// 处理详细评价确认
async function handleDetailedEvaluationConfirm(userId, data, query) {
    try {
        if (data.startsWith('detail_confirm_')) {
            const evaluationId = data.replace('detail_confirm_', '');
            const evalSession = dbOperations.getEvaluationSession(userId, evaluationId);
            
            if (evalSession) {
                const detailScores = JSON.parse(evalSession.temp_data || '{}');
                
                // 保存详细评价到数据库
                evaluationService.updateEvaluation(evaluationId, null, detailScores, '详细评价已完成', 'completed');
                
                // 发送完成消息
                await sendMessageWithDelete(userId, '🎉 详细评价提交成功！\n\n🙏 感谢老师您耐心评价，这将会纳入您的评价数据\n📊 未来小鸡会总结您的全面总结上课报告数据！', {}, 'detailed_evaluation_complete');
            }
            
        } else if (data.startsWith('detail_restart_')) {
            const evaluationId = data.replace('detail_restart_', '');
            
            // 重新开始详细评价流程
            const sessionId = dbOperations.createEvaluationSession(userId, evaluationId);
            
            // 开始详细评价流程 - 第一项：鸡鸡长度
            const message = `详细评价\n\n鸡鸡长度：`;
            const keyboard = {
                inline_keyboard: [
                    [
                        { text: '1', callback_data: `detail_length_1_${evaluationId}` },
                        { text: '2', callback_data: `detail_length_2_${evaluationId}` },
                        { text: '3', callback_data: `detail_length_3_${evaluationId}` },
                        { text: '4', callback_data: `detail_length_4_${evaluationId}` },
                        { text: '5', callback_data: `detail_length_5_${evaluationId}` }
                    ],
                    [
                        { text: '6', callback_data: `detail_length_6_${evaluationId}` },
                        { text: '7', callback_data: `detail_length_7_${evaluationId}` },
                        { text: '8', callback_data: `detail_length_8_${evaluationId}` },
                        { text: '9', callback_data: `detail_length_9_${evaluationId}` },
                        { text: '10', callback_data: `detail_length_10_${evaluationId}` }
                    ],
                    [
                        { text: '⬅️ 返回', callback_data: `back_detailed_evaluation_${evaluationId}` }
                    ]
                ]
            };
            
            await sendMessageWithDelete(userId, message, { 
                reply_markup: keyboard 
            }, 'detailed_evaluation', {
                evaluationId,
                step: 'length'
            });
            
            // 更新评价会话状态
            dbOperations.updateEvaluationSession(sessionId, 'detail_length', {});
        }
        
    } catch (error) {
        console.error('处理详细评价确认失败:', error);
    }
}

// 显示播报选择
async function showBroadcastChoice(userId, evaluationId) {
    try {
        const message = `🎉 恭喜您完成一次评价～ 
经管理员审核后为您添加积分，等级会自动更新！
————————————————
是否在大群播报本次出击记录？`;
        
        const keyboard = {
            inline_keyboard: [
                [
                    { text: '实名播报', callback_data: `broadcast_real_${evaluationId}` },
                    { text: '匿名播报', callback_data: `broadcast_anon_${evaluationId}` }
                ]
            ]
        };
        
        await sendMessageWithoutDelete(userId, message, { 
            reply_markup: keyboard 
        }, 'broadcast_choice', {
            evaluationId
        });
        
        // 清除之前的倒计时（如果存在）
        const existingTimer = broadcastTimers.get(userId);
        if (existingTimer) {
            clearTimeout(existingTimer.timeoutId);
            broadcastTimers.delete(userId);
        }
        
        // 5分钟后自动匿名播报（后端逻辑，不显示给用户）
        const timeoutId = setTimeout(async () => {
            try {
                console.log(`用户 ${userId} 播报选择超时，自动执行匿名播报`);
                
                // 清除倒计时
                broadcastTimers.delete(userId);
                
                // 自动执行匿名播报
                await handleAnonymousBroadcast(userId, evaluationId, { from: { username: null } });
                
            } catch (error) {
                console.error('自动匿名播报失败:', error);
            }
        }, 300000); // 5分钟 = 300000毫秒
        
        // 保存倒计时信息
        broadcastTimers.set(userId, {
            evaluationId,
            timeoutId
        });
        
    } catch (error) {
        console.error('显示播报选择失败:', error);
    }
}

// 处理播报选择
async function handleBroadcastChoice(userId, data, query) {
    try {
        // 清除用户的倒计时（如果存在）
        const existingTimer = broadcastTimers.get(userId);
        if (existingTimer) {
            clearTimeout(existingTimer.timeoutId);
            broadcastTimers.delete(userId);
        }
        
        if (data.startsWith('broadcast_real_')) {
            const evaluationId = data.replace('broadcast_real_', '');
            await handleRealBroadcast(userId, evaluationId, query);
            
        } else if (data.startsWith('broadcast_anon_')) {
            const evaluationId = data.replace('broadcast_anon_', '');
            await handleAnonymousBroadcast(userId, evaluationId, query);
        }
        
    } catch (error) {
        console.error('处理播报选择失败:', error);
    }
}

// 处理实名播报
async function handleRealBroadcast(userId, evaluationId, query) {
    try {
        console.log(`=== 开始实名播报调试 ===`);
        console.log(`userId: ${userId}, evaluationId: ${evaluationId}`);
        
        // 获取评价信息
        const evaluation = dbOperations.getEvaluation(evaluationId);
        console.log(`获取评价信息:`, evaluation);
        if (!evaluation) {
            console.log(`评价信息不存在 - evaluationId: ${evaluationId}`);
            await sendMessageWithoutDelete(userId, '评价信息不存在，播报失败。', {}, 'broadcast_error');
            return;
        }

        // 获取预约会话信息
        const bookingSession = dbOperations.getBookingSession(evaluation.booking_session_id);
        console.log(`获取预约会话信息:`, bookingSession);
        if (!bookingSession) {
            console.log(`预约信息不存在 - booking_session_id: ${evaluation.booking_session_id}`);
            await sendMessageWithoutDelete(userId, '预约信息不存在，播报失败。', {}, 'broadcast_error');
            return;
        }

        // 获取商家信息
        const merchant = dbOperations.getMerchantById(bookingSession.merchant_id);
        console.log(`获取商家信息:`, merchant);
        if (!merchant) {
            console.log(`商家信息不存在 - merchant_id: ${bookingSession.merchant_id}`);
            await sendMessageWithoutDelete(userId, '商家信息不存在，播报失败。', {}, 'broadcast_error');
            return;
        }

        // 获取用户信息
        const username = query.from.username ? `@${query.from.username}` : '未设置用户名';
        const teacherName = merchant.teacher_name || '未知老师';
        console.log(`用户信息: ${username}, 老师名称: ${teacherName}`);

        // 构建实名播报消息
        const broadcastMessage = `🎉 恭喜小鸡的勇士：用户（${username}）出击了 #${teacherName} 老师！
🐤 小鸡出征！咯咯哒咯咯哒～`;
        console.log(`播报消息内容:`, broadcastMessage);

        // 发送到群组播报
        const GROUP_CHAT_ID = process.env.GROUP_CHAT_ID;
        if (!GROUP_CHAT_ID) {
            console.error('❌ GROUP_CHAT_ID 环境变量未设置');
            await sendMessageWithoutDelete(userId, '❌ 播报失败：群组配置未设置，请联系管理员。', {}, 'broadcast_error');
            return;
        }
        console.log(`目标群组ID: ${GROUP_CHAT_ID}`);
        
        try {
            console.log(`正在发送消息到群组...`);
            const sentMessage = await bot.sendMessage(GROUP_CHAT_ID, broadcastMessage);
            console.log(`消息发送成功, message_id: ${sentMessage.message_id}`);
            
            // 置顶播报消息
            try {
                console.log(`正在置顶消息...`);
                await bot.pinChatMessage(GROUP_CHAT_ID, sentMessage.message_id);
                console.log(`播报消息已置顶: ${sentMessage.message_id}`);
            } catch (pinError) {
                console.log(`置顶消息失败: ${pinError.message}`);
                // 置顶失败不影响播报成功
            }
            
            // 给用户发送播报成功确认
            await sendMessageWithoutDelete(userId, '✅ 实名播报成功！您的出击记录已在群内公布。', {}, 'broadcast_success');
            console.log(`=== 实名播报成功 ===`);
            
        } catch (groupError) {
            console.error('群组播报失败:', groupError);
            console.error('错误详情:', {
                message: groupError.message,
                code: groupError.code,
                response: groupError.response?.body
            });
            
            // 检查具体错误类型并给出更详细的错误信息
            let errorMessage = '❌ 播报失败，请联系管理员。';
            if (groupError.message.includes('chat not found')) {
                errorMessage = '❌ 播报失败：群组未找到，请检查群组ID配置。';
            } else if (groupError.message.includes('not enough rights')) {
                errorMessage = '❌ 播报失败：机器人没有发送消息权限，请联系群组管理员。';
            } else if (groupError.message.includes('bot was blocked')) {
                errorMessage = '❌ 播报失败：机器人被群组封禁，请联系群组管理员。';
            }
            
            await sendMessageWithoutDelete(userId, errorMessage, {}, 'broadcast_error');
        }
        
    } catch (error) {
        console.error('处理实名播报失败:', error);
        console.error('错误堆栈:', error.stack);
        await sendMessageWithoutDelete(userId, '❌ 播报失败，请联系管理员。', {}, 'broadcast_error');
    }
}

// 处理匿名播报
async function handleAnonymousBroadcast(userId, evaluationId, query) {
    try {
        console.log(`=== 开始匿名播报调试 ===`);
        console.log(`userId: ${userId}, evaluationId: ${evaluationId}`);
        
        // 获取评价信息
        const evaluation = dbOperations.getEvaluation(evaluationId);
        console.log(`获取评价信息:`, evaluation);
        if (!evaluation) {
            console.log(`评价信息不存在 - evaluationId: ${evaluationId}`);
            await sendMessageWithoutDelete(userId, '评价信息不存在，播报失败。', {}, 'broadcast_error');
            return;
        }

        // 获取预约会话信息
        const bookingSession = dbOperations.getBookingSession(evaluation.booking_session_id);
        console.log(`获取预约会话信息:`, bookingSession);
        if (!bookingSession) {
            console.log(`预约信息不存在 - booking_session_id: ${evaluation.booking_session_id}`);
            await sendMessageWithoutDelete(userId, '预约信息不存在，播报失败。', {}, 'broadcast_error');
            return;
        }

        // 获取商家信息
        const merchant = dbOperations.getMerchantById(bookingSession.merchant_id);
        console.log(`获取商家信息:`, merchant);
        if (!merchant) {
            console.log(`商家信息不存在 - merchant_id: ${bookingSession.merchant_id}`);
            await sendMessageWithoutDelete(userId, '商家信息不存在，播报失败。', {}, 'broadcast_error');
            return;
        }

        const teacherName = merchant.teacher_name || '未知老师';
        console.log(`老师名称: ${teacherName}`);

        // 构建匿名播报消息
        const broadcastMessage = `🎉 恭喜小鸡的勇士：隐藏用户 出击了 #${teacherName} 老师！
🐤 小鸡出征！咯咯哒咯咯哒～`;
        console.log(`播报消息内容:`, broadcastMessage);

        // 发送到群组播报
        const GROUP_CHAT_ID = process.env.GROUP_CHAT_ID;
        if (!GROUP_CHAT_ID) {
            console.error('❌ GROUP_CHAT_ID 环境变量未设置');
            await sendMessageWithoutDelete(userId, '❌ 播报失败：群组配置未设置，请联系管理员。', {}, 'broadcast_error');
            return;
        }
        console.log(`目标群组ID: ${GROUP_CHAT_ID}`);
        
        try {
            console.log(`正在发送消息到群组...`);
            const sentMessage = await bot.sendMessage(GROUP_CHAT_ID, broadcastMessage);
            console.log(`消息发送成功, message_id: ${sentMessage.message_id}`);
            
            // 置顶播报消息
            try {
                console.log(`正在置顶消息...`);
                await bot.pinChatMessage(GROUP_CHAT_ID, sentMessage.message_id);
                console.log(`播报消息已置顶: ${sentMessage.message_id}`);
            } catch (pinError) {
                console.log(`置顶消息失败: ${pinError.message}`);
                // 置顶失败不影响播报成功
            }
            
            // 给用户发送播报成功确认
            await sendMessageWithoutDelete(userId, '✅ 匿名播报成功！您的出击记录已在群内公布。', {}, 'broadcast_success');
            console.log(`=== 匿名播报成功 ===`);
            
        } catch (groupError) {
            console.error('群组播报失败:', groupError);
            console.error('错误详情:', {
                message: groupError.message,
                code: groupError.code,
                response: groupError.response?.body
            });
            
            // 检查具体错误类型并给出更详细的错误信息
            let errorMessage = '❌ 播报失败，请联系管理员。';
            if (groupError.message.includes('chat not found')) {
                errorMessage = '❌ 播报失败：群组未找到，请检查群组ID配置。';
            } else if (groupError.message.includes('not enough rights')) {
                errorMessage = '❌ 播报失败：机器人没有发送消息权限，请联系群组管理员。';
            } else if (groupError.message.includes('bot was blocked')) {
                errorMessage = '❌ 播报失败：机器人被群组封禁，请联系群组管理员。';
            }
            
            await sendMessageWithoutDelete(userId, errorMessage, {}, 'broadcast_error');
        }
        
    } catch (error) {
        console.error('处理匿名播报失败:', error);
        console.error('错误堆栈:', error.stack);
        await sendMessageWithoutDelete(userId, '❌ 播报失败，请联系管理员。', {}, 'broadcast_error');
    }
}

// 处理商家详细评价评分
async function handleMerchantDetailEvaluationScoring(userId, data, query) {
    try {
        const parts = data.split('_');
        let evaluationType, score, evaluationId;
        
        if (data.startsWith('merchant_detail_eval_start_')) {
            // 开始详细评价流程
            evaluationId = data.replace('merchant_detail_eval_start_', '');
            startMerchantDetailEvaluation(userId, evaluationId);
            return;
            
        } else if (data.startsWith('merchant_detail_eval_no_')) {
            // 不进行详细评价 - 只更新状态，保留已有的总体评分
            evaluationId = data.replace('merchant_detail_eval_no_', '');
            
            // 使用evaluationService，只更新状态，保留总体评分
            evaluationService.updateEvaluation(evaluationId, null, null, null, 'completed');
            
            // 商家选择不进行详细评价后，直接结束流程（商家不需要播报）
            await bot.sendMessage(userId, '🎉 评价提交成功！\n\n感谢老师您的评价～\n\n欢迎下次为小鸡服务！');
            
            return;
            
        } else if (data.includes('_duration_')) {
            // 处理单次做爱时间选择
            evaluationType = 'duration';
            const durationParts = data.split('_duration_');
            score = durationParts[1].split('_')[0];
            evaluationId = durationParts[1].split('_')[1];
            
        } else {
            // 处理数字评分 (鸡鸡长度、硬度)
            evaluationType = parts[3]; // length, hardness
            score = parseInt(parts[4]);
            evaluationId = parts[5];
        }
        
        // 获取评价会话
        const evalSession = dbOperations.getEvaluationSession(userId, evaluationId);
        if (!evalSession) {
            bot.sendMessage(userId, '评价会话已失效，请重新开始评价。');
            return;
        }
        
        let tempData = {};
        try {
            tempData = JSON.parse(evalSession.temp_data || '{}');
        } catch (e) {
            tempData = {};
        }
        
        // 保存当前评分
        tempData[evaluationType] = score;
        
        // 定义详细评价流程顺序
        const detailSteps = ['length', 'hardness', 'duration'];
        const currentIndex = detailSteps.indexOf(evaluationType);
        
        if (currentIndex < detailSteps.length - 1) {
            // 继续下一个详细评价项目
            const nextStep = detailSteps[currentIndex + 1];
            const nextMessage = getMerchantDetailEvaluationMessage(nextStep);
            const nextKeyboard = getMerchantDetailEvaluationKeyboard(nextStep, evaluationId);
            
            // 更新评价会话
            dbOperations.updateEvaluationSession(evalSession.id, `merchant_detail_${nextStep}`, tempData);
            
            // 发送下一个评价项目
            bot.sendMessage(userId, nextMessage, { reply_markup: nextKeyboard });
            
        } else {
            // 进入额外点评环节
            dbOperations.updateEvaluationSession(evalSession.id, 'merchant_detail_comment', tempData);
            
            const message = `额外点评（额外输入文字点评，任何都行）：

请输入您的额外点评，或直接点击提交按钮完成评价。`;
            
            const keyboard = {
                inline_keyboard: [
                    [
                        { text: '确认提交报告🎫', callback_data: `merchant_detail_eval_confirm_${evaluationId}` }
                    ],
                    [
                        { text: '⬅️ 返回', callback_data: `back_merchant_detail_eval_${evaluationId}` }
                    ]
                ]
            };
            
            bot.sendMessage(userId, message, { reply_markup: keyboard });
        }
        
    } catch (error) {
        console.error('处理商家详细评价评分失败:', error);
    }
}

// 开始商家详细评价流程
async function startMerchantDetailEvaluation(userId, evaluationId) {
    try {
        // 创建详细评价会话
        const sessionId = dbOperations.createEvaluationSession(userId, evaluationId);
        
        // 开始详细评价流程 - 第一项：鸡鸡长度
        const message = `鸡鸡长度（输入数字1-10评分）：`;
        const keyboard = getMerchantDetailEvaluationKeyboard('length', evaluationId);
        
        bot.sendMessage(userId, message, { reply_markup: keyboard });
        
        // 更新评价会话状态
        dbOperations.updateEvaluationSession(sessionId, 'merchant_detail_length', {});
        
    } catch (error) {
        console.error('开始商家详细评价流程失败:', error);
    }
}

// 获取商家详细评价消息
function getMerchantDetailEvaluationMessage(step) {
    const messages = {
        'length': '鸡鸡长度（输入数字1-10评分）：',
        'hardness': '鸡鸡硬度（输入数字1-10评分）：',
        'duration': '单次做爱时间：'
    };
    return messages[step] || '评价：';
}

// 获取商家详细评价键盘
function getMerchantDetailEvaluationKeyboard(step, evaluationId) {
    if (step === 'length' || step === 'hardness') {
        return {
            inline_keyboard: [
                [
                    { text: '1', callback_data: `merchant_detail_eval_${step}_1_${evaluationId}` },
                    { text: '2', callback_data: `merchant_detail_eval_${step}_2_${evaluationId}` },
                    { text: '3', callback_data: `merchant_detail_eval_${step}_3_${evaluationId}` },
                    { text: '4', callback_data: `merchant_detail_eval_${step}_4_${evaluationId}` },
                    { text: '5', callback_data: `merchant_detail_eval_${step}_5_${evaluationId}` }
                ],
                [
                    { text: '6', callback_data: `merchant_detail_eval_${step}_6_${evaluationId}` },
                    { text: '7', callback_data: `merchant_detail_eval_${step}_7_${evaluationId}` },
                    { text: '8', callback_data: `merchant_detail_eval_${step}_8_${evaluationId}` },
                    { text: '9', callback_data: `merchant_detail_eval_${step}_9_${evaluationId}` },
                    { text: '10', callback_data: `merchant_detail_eval_${step}_10_${evaluationId}` }
                ],
                [
                    { text: '⬅️ 返回', callback_data: `back_merchant_detail_eval_${evaluationId}` }
                ]
            ]
        };
    } else if (step === 'duration') {
        return {
            inline_keyboard: [
                [
                    { text: '1分钟内', callback_data: `merchant_detail_eval_duration_1min_${evaluationId}` },
                    { text: '3分钟', callback_data: `merchant_detail_eval_duration_3min_${evaluationId}` },
                    { text: '5分钟', callback_data: `merchant_detail_eval_duration_5min_${evaluationId}` }
                ],
                [
                    { text: '10分钟', callback_data: `merchant_detail_eval_duration_10min_${evaluationId}` },
                    { text: '15分钟', callback_data: `merchant_detail_eval_duration_15min_${evaluationId}` },
                    { text: '30分钟', callback_data: `merchant_detail_eval_duration_30min_${evaluationId}` }
                ],
                [
                    { text: '1小时以上', callback_data: `merchant_detail_eval_duration_1hour_${evaluationId}` },
                    { text: '未出水💦', callback_data: `merchant_detail_eval_duration_no_${evaluationId}` }
                ],
                [
                    { text: '⬅️ 返回', callback_data: `back_merchant_detail_eval_${evaluationId}` }
                ]
            ]
        };
    }
}

// 处理商家详细评价确认
async function handleMerchantDetailEvaluationConfirm(userId, data, query) {
    try {
        const evaluationId = data.replace('merchant_detail_eval_confirm_', '');
        const evalSession = dbOperations.getEvaluationSession(userId, evaluationId);
        
        if (evalSession) {
            const detailScores = JSON.parse(evalSession.temp_data || '{}');
            
            // 获取现有评价，保留overall_score
            const existingEvaluation = evaluationService.getEvaluation(evaluationId);
            const existingOverallScore = existingEvaluation ? existingEvaluation.overall_score : null;
            
            console.log('=== 商家详细评价确认调试 ===');
            console.log('evaluationId:', evaluationId);
            console.log('detailScores:', detailScores);
            console.log('existingOverallScore:', existingOverallScore);
            
            // 检查是否有文字评价
            const hasTextComment = detailScores.textComment && detailScores.textComment.trim() !== '';
            
            if (hasTextComment) {
                console.log('检测到文字评价:', detailScores.textComment);
                
                // 保存完整的详细评价到数据库，包括文字评价
                evaluationService.updateEvaluation(evaluationId, existingOverallScore, detailScores, detailScores.textComment, 'completed');
                
                // 兼容性：同时更新orders表中的商家评价字段
                const evaluation = evaluationService.getEvaluation(evaluationId);
                if (evaluation && evaluation.booking_session_id) {
                    const order = dbOperations.getOrderByBookingSession(evaluation.booking_session_id);
                    if (order) {
                        const evaluationData = JSON.stringify({
                            overall_score: existingOverallScore,
                            scores: detailScores,
                            textComment: detailScores.textComment,
                            created_at: Math.floor(Date.now() / 1000)
                        });
                        dbOperations.updateOrderFields(order.id, {
                            merchant_evaluation: evaluationData,
                            updated_at: Math.floor(Date.now() / 1000)
                        });
                        console.log(`📝 兼容性：商家完整评价数据已同步到orders表，订单ID: ${order.id}`);
                    }
                }
                
                // 删除评价会话
                dbOperations.deleteEvaluationSession(evalSession.id);
                
                // 发送完成消息
                await bot.sendMessage(userId, '🎉 详细评价提交成功！\n\n🙏 感谢老师您耐心评价，这将会纳入您的评价数据\n📊 未来小鸡会总结您的全面总结上课报告数据！');
                
                // 商家详细评价完成后，直接结束流程（商家不需要播报）
                setTimeout(async () => {
                    await bot.sendMessage(userId, '欢迎下次为小鸡服务！');
                }, 1000);
            } else {
                console.log('没有检测到文字评价，只保存评分数据');
                
                // 只保存评分数据，状态设为详细评价完成但可能需要文字评价
                evaluationService.updateEvaluation(evaluationId, existingOverallScore, detailScores, null, 'detail_completed');
                
                // 发送完成消息，但提示可以补充文字评价
                await bot.sendMessage(userId, '🎉 详细评价提交成功！\n\n🙏 感谢老师您的评价～\n\n欢迎下次为小鸡服务！');
            }
            
            console.log('=== 商家详细评价确认调试结束 ===');
        }
        
    } catch (error) {
        console.error('处理商家详细评价确认失败:', error);
    }
}

// 处理商家详细评价返回
async function handleMerchantDetailEvaluationBack(userId, data, query) {
    try {
        // 提取evaluationId
        const evaluationId = data.split('_').pop();
        
        // 获取评价会话
        const evalSession = dbOperations.getEvaluationSession(userId, evaluationId);
        if (!evalSession) {
            await sendMessageWithDelete(userId, '评价会话已失效，请重新开始评价。', {}, 'evaluation_expired');
            return;
        }
        
        // 根据当前步骤返回到上一步
        const currentStep = evalSession.current_step;
        
        // 如果当前在额外点评页面，返回到最后一个评价项目
        if (currentStep === 'merchant_detail_comment') {
            const lastStep = 'duration';
            const lastMessage = getMerchantDetailEvaluationMessage(lastStep);
            const lastKeyboard = getMerchantDetailEvaluationKeyboard(lastStep, evaluationId);
            
            // 更新评价会话到最后一个评价步骤
            dbOperations.updateEvaluationSession(evalSession.id, `merchant_detail_${lastStep}`, evalSession.temp_data);
            
            await sendMessageWithDelete(userId, lastMessage, { 
                reply_markup: lastKeyboard 
            }, 'merchant_detail_evaluation', {
                evaluationId,
                step: lastStep
            });
            return;
        }
        
        if (currentStep === 'merchant_detail_length') {
            // 从商家详细评价第一步返回到确认页面
            const evaluation = dbOperations.getEvaluation(evaluationId);
            if (evaluation) {
                const message = `是否进行详细评价？`;
                const keyboard = {
                    inline_keyboard: [
                        [
                            { text: '确认✅', callback_data: `merchant_detail_eval_start_${evaluationId}` },
                            { text: '不了👋', callback_data: `merchant_detail_eval_no_${evaluationId}` }
                        ],
                        [
                            { text: '⬅️ 返回', callback_data: `back_merchant_detail_confirm_${evaluationId}` }
                        ]
                    ]
                };
                
                await sendMessageWithDelete(userId, message, { 
                    reply_markup: keyboard 
                }, 'merchant_detail_confirm', {
                    evaluationId,
                    score: evaluation.overall_score
                });
            }
        } else {
            // 返回到上一个商家详细评价步骤
            const detailSteps = ['length', 'hardness', 'duration'];
            const currentStepName = currentStep.replace('merchant_detail_', '');
            const currentIndex = detailSteps.indexOf(currentStepName);
            
            if (currentIndex > 0) {
                const prevStep = detailSteps[currentIndex - 1];
                const prevMessage = getMerchantDetailEvaluationMessage(prevStep);
                const prevKeyboard = getMerchantDetailEvaluationKeyboard(prevStep, evaluationId);
                
                // 更新评价会话到上一步
                dbOperations.updateEvaluationSession(evalSession.id, `merchant_detail_${prevStep}`, evalSession.temp_data);
                
                await sendMessageWithDelete(userId, prevMessage, { 
                    reply_markup: prevKeyboard 
                }, 'merchant_detail_evaluation', {
                    evaluationId,
                    step: prevStep
                });
            }
        }
        
    } catch (error) {
        console.error('处理商家详细评价返回失败:', error);
        await sendMessageWithDelete(userId, '返回操作失败，请重新开始评价。', {}, 'back_error');
    }
}

// 处理返回到预约选择页面
async function handleBackToBookingOptions(userId, sessionId) {
    try {
        const bookingSession = dbOperations.getBookingSession(sessionId);
        if (bookingSession) {
            const merchant = dbOperations.getMerchantById(bookingSession.merchant_id);
            if (merchant) {
                // 清除该用户对该商家的预约冷却时间，允许重新预约
                const cooldownKey = `${userId}_${merchant.id}`;
                bookingCooldowns.delete(cooldownKey);
                console.log(`已清除用户 ${userId} 对商家 ${merchant.id} 的预约冷却时间`);
                
                const attackMessage = `✅本榜单老师均已通过视频认证，请小鸡们放心预约。
————————————————————————————
🔔提示：
1.定金大多数不会超过100哦～ 
2.如果老师以前不需要定金，突然需要定金了，请跟管理员核实。`;
                
                const options = {
                    reply_markup: {
                        inline_keyboard: [
                            [{ text: '预约p', callback_data: `book_p_${merchant.id}` }],
                            [{ text: '预约pp', callback_data: `book_pp_${merchant.id}` }],
                            [{ text: '其他时长', callback_data: `book_other_${merchant.id}` }]
                        ]
                    }
                };
                
                await sendMessageWithDelete(userId, attackMessage, options, 'booking_options', {
                    merchantId: merchant.id
                });
            }
        }
    } catch (error) {
        console.error('返回预约选择页面失败:', error);
    }
}

// 处理返回到联系老师页面
async function handleBackToContact(userId, sessionId) {
    try {
        const bookingSession = dbOperations.getBookingSession(sessionId);
        if (bookingSession) {
            const merchant = dbOperations.getMerchantById(bookingSession.merchant_id);
            if (merchant) {
                let contactLink = merchant.contact;
                if (contactLink && contactLink.startsWith('@')) {
                    contactLink = `[${contactLink}](https://t.me/${contactLink.substring(1)})`;
                }
                
                const message = `🐤小鸡出征！
         已将出击信息发送给${contactLink}老师。请点击联系方式开始私聊老师进行预约。`;
                
                // 使用不删除历史的发送方式，保留联系老师信息
                await sendMessageWithoutDelete(userId, message, {
                    parse_mode: 'Markdown'
                }, 'contact_teacher', {
                    bookingSessionId: sessionId,
                    teacherName: merchant.teacher_name
                });
            }
        }
    } catch (error) {
        console.error('返回联系老师页面失败:', error);
    }
}

// 处理返回到课程完成确认
async function handleBackToCourseCompletion(userId, sessionId) {
    try {
        const bookingSession = dbOperations.getBookingSession(sessionId);
        if (bookingSession) {
            const merchant = dbOperations.getMerchantById(bookingSession.merchant_id);
            if (merchant) {
                const userFullName = '用户'; // 简化处理
                const teacherName = merchant.teacher_name;
                
                // 只给当前用户发送确认消息，避免重复发给商家
                const isUser = userId === bookingSession.user_id;
                
                // 获取老师联系方式（用于用户消息）
                let teacherContact = teacherName; // 默认使用艺名
                if (merchant && merchant.contact) {
                    // 确保联系方式有@符号
                    teacherContact = merchant.contact.startsWith('@') ? merchant.contact : `@${merchant.contact}`;
                }
                
                const message = isUser ? 
                    `是否完成该老师（${teacherName} ${teacherContact}）的课程？` : 
                    `是否完成该用户（${userFullName}）的课程？`;
                    
                const keyboard = {
                    inline_keyboard: [
                        [
                            { text: '已完成', callback_data: `course_completed_${sessionId}` },
                            { text: '未完成', callback_data: `course_incomplete_${sessionId}` }
                        ]
                    ]
                };
                
                await sendMessageWithDelete(userId, message, { 
                    reply_markup: keyboard 
                }, 'course_completion_check', {
                    bookingSessionId: sessionId,
                    merchantId: merchant.id,
                    userFullName,
                    username: '',
                    teacherName
                });
            }
        }
    } catch (error) {
        console.error('返回课程完成确认失败:', error);
    }
}

// 处理返回到商家评分选择
async function handleBackToMerchantScoring(userId, evaluationId) {
    try {
        const evaluation = dbOperations.getEvaluation(evaluationId);
        if (evaluation) {
            const bookingSession = dbOperations.getBookingSession(evaluation.booking_session_id);
            if (bookingSession) {
                // 重新显示商家评分页面
                const message = `出击总体素质：`;
                const keyboard = {
                    inline_keyboard: [
                        [
                            { text: '1', callback_data: `eval_score_1_${evaluationId}` },
                            { text: '2', callback_data: `eval_score_2_${evaluationId}` },
                            { text: '3', callback_data: `eval_score_3_${evaluationId}` },
                            { text: '4', callback_data: `eval_score_4_${evaluationId}` },
                            { text: '5', callback_data: `eval_score_5_${evaluationId}` }
                        ],
                        [
                            { text: '6', callback_data: `eval_score_6_${evaluationId}` },
                            { text: '7', callback_data: `eval_score_7_${evaluationId}` },
                            { text: '8', callback_data: `eval_score_8_${evaluationId}` },
                            { text: '9', callback_data: `eval_score_9_${evaluationId}` },
                            { text: '10', callback_data: `eval_score_10_${evaluationId}` }
                        ],
                        [
                            { text: '⬅️ 返回', callback_data: `back_merchant_evaluation_${bookingSession.id}` }
                        ]
                    ]
                };
                
                await sendMessageWithDelete(userId, message, { 
                    reply_markup: keyboard 
                }, 'merchant_evaluation', {
                    evaluationId,
                    bookingSessionId: bookingSession.id,
                    step: 'overall_score'
                });
            }
        }
    } catch (error) {
        console.error('返回商家评分选择失败:', error);
    }
}

// 处理返回到播报选择
async function handleBackToBroadcastChoice(userId, evaluationId) {
    try {
        const evalSession = dbOperations.getEvaluationSession(userId, evaluationId);
        if (evalSession) {
            const scores = JSON.parse(evalSession.temp_data || '{}');
            
            // 重新显示评价总结页面
            await showEvaluationSummary(userId, evaluationId, scores);
        }
    } catch (error) {
        console.error('返回播报选择失败:', error);
    }
}

// 处理返回到商家评分确认
async function handleBackToMerchantScoreConfirm(userId, evaluationId) {
    try {
        // 这里需要获取之前的评分，但由于我们没有保存临时评分，
        // 我们直接返回到评分选择页面
        await handleBackToMerchantScoring(userId, evaluationId);
    } catch (error) {
        console.error('返回商家评分确认失败:', error);
    }
}

// 处理详细评价返回
async function handleDetailedEvaluationBack(userId, data, query) {
    try {
        // 提取evaluationId
        const evaluationId = data.split('_').pop();
        
        // 获取评价会话
        const evalSession = dbOperations.getEvaluationSession(userId, evaluationId);
        if (!evalSession) {
            await sendMessageWithDelete(userId, '评价会话已失效，请重新开始评价。', {}, 'evaluation_expired');
            return;
        }
        
        // 根据当前步骤返回到上一步
        const currentStep = evalSession.current_step;
        
        if (currentStep === 'detail_length') {
            // 从详细评价第一步返回到商家评价确认页面
            const evaluation = dbOperations.getEvaluation(evaluationId);
            if (evaluation) {
                const message = `是否进行详细评价？`;
                const keyboard = {
                    inline_keyboard: [
                        [
                            { text: '确认✅', callback_data: `merchant_detail_eval_start_${evaluationId}` },
                            { text: '不了👋', callback_data: `merchant_detail_eval_no_${evaluationId}` }
                        ],
                        [
                            { text: '⬅️ 返回', callback_data: `back_merchant_detail_confirm_${evaluationId}` }
                        ]
                    ]
                };
                
                await sendMessageWithDelete(userId, message, { 
                    reply_markup: keyboard 
                }, 'merchant_detail_confirm', {
                    evaluationId,
                    score: evaluation.overall_score
                });
            }
        } else {
            // 返回到上一个详细评价步骤
            const detailSteps = ['length', 'thickness', 'durability', 'technique'];
            const currentStepName = currentStep.replace('detail_', '');
            const currentIndex = detailSteps.indexOf(currentStepName);
            
            if (currentIndex > 0) {
                const prevStep = detailSteps[currentIndex - 1];
                const prevMessage = getDetailedEvaluationMessage(prevStep);
                const prevKeyboard = getDetailedEvaluationKeyboard(prevStep, evaluationId);
                
                // 更新评价会话到上一步
                dbOperations.updateEvaluationSession(evalSession.id, `detail_${prevStep}`, evalSession.temp_data);
                
                await sendMessageWithDelete(userId, prevMessage, { 
                    reply_markup: prevKeyboard 
                }, 'detailed_evaluation', {
                    evaluationId,
                    step: prevStep
                });
            }
        }
        
    } catch (error) {
        console.error('处理详细评价返回失败:', error);
        await sendMessageWithDelete(userId, '返回操作失败，请重新开始评价。', {}, 'back_error');
    }
}

// 发送约课成功确认消息
async function sendBookingSuccessCheck(userId, bookingSessionId, merchant, bookType, fullName, username) {
    try {
        const message = `⚠️ 预约后再点击本条信息 ⚠️

跟老师约课成功了吗？

⚠️ 预约后再点击本条信息 ⚠️

跟老师约课成功了吗？`;
        
        const keyboard = {
            inline_keyboard: [
                [
                    { text: '成功✅', callback_data: `booking_success_${bookingSessionId}` },
                    { text: '未约成❌', callback_data: `booking_failed_${bookingSessionId}` }
                ]
            ]
        };
        
        // 使用不删除历史的方式发送约课成功确认消息
        await sendMessageWithoutDelete(userId, message, { 
            reply_markup: keyboard 
        }, 'booking_success_check', {
            bookingSessionId,
            merchantId: merchant.id,
            bookType,
            fullName,
            username,
            teacherName: merchant.teacher_name
        });
        
    } catch (error) {
        console.error('发送约课成功确认消息失败:', error);
    }
}

// 处理约课成功确认流程
async function handleBookingSuccessFlow(userId, data, query) {
    try {
        if (data.startsWith('booking_success_')) {
            const bookingSessionId = data.replace('booking_success_', '');
            const bookingSession = dbOperations.getBookingSession(bookingSessionId);
            
            if (bookingSession) {
                // 查找对应的订单并更新状态
                const existingOrder = dbOperations.getRecentAttemptingOrder(userId, bookingSession.merchant_id) || 
                                    dbOperations.getOrderByStatus(userId, bookingSession.merchant_id, 'pending');
                
                let orderId;
                if (existingOrder) {
                    // 更新现有订单状态
                    const updateData = {
                        booking_session_id: bookingSessionId,
                        status: 'confirmed', // 约课成功
                        updated_at: new Date().toISOString()
                    };
                    dbOperations.updateOrderFields(existingOrder.id, updateData);
                    orderId = existingOrder.id;
                    console.log(`✅ 更新订单状态成功: 订单ID ${orderId}, 状态: confirmed`);
                } else {
                    // 如果没有找到现有订单，创建新订单（兼容旧逻辑）
                    orderId = await createOrderData(bookingSession, userId, query);
                }
                
                await sendMessageWithoutDelete(userId, '✅ 约课成功！\n\n👩🏻‍🏫 上完课后返回此处\n\n✍🏻 完成老师课程评价\n\n😭 这将对老师有很大帮助！', {}, 'booking_success_confirmed');
                
                // 延迟10分钟发送课程完成确认消息，并在此时清空对话历史
                setTimeout(async () => {
                    const merchant = dbOperations.getMerchantById(bookingSession.merchant_id);
                    const userFullName = `${query.from.first_name || ''} ${query.from.last_name || ''}`.trim() || '未设置名称';
                    const username = query.from.username ? `@${query.from.username}` : '未设置用户名';
                    
                    // 在发送课程完成检查前清空对话历史（包括小鸡出征消息）
                    await clearUserConversation(userId);
                    
                    // 只有绑定了真实ID的商家才发送课程完成确认
                    if (merchant.user_id) {
                        await sendCourseCompletionCheck(userId, merchant.user_id, bookingSessionId, userFullName, username, merchant.teacher_name);
                    }
                }, 10 * 60 * 1000); // 10分钟 = 10 * 60 * 1000毫秒
                
                console.log(`用户 ${userId} 确认约课成功，预约会话 ${bookingSessionId}，订单ID ${orderId}`);
                
            } else {
                console.log('预约信息不存在');
            }
            
        } else if (data.startsWith('booking_failed_')) {
            const bookingSessionId = data.replace('booking_failed_', '');
            const bookingSession = dbOperations.getBookingSession(bookingSessionId);
            
            if (bookingSession) {
                // 查找对应的订单并更新状态为失败
                const existingOrder = dbOperations.getRecentAttemptingOrder(userId, bookingSession.merchant_id) || 
                                    dbOperations.getOrderByStatus(userId, bookingSession.merchant_id, 'pending');
                
                if (existingOrder) {
                    const updateData = {
                        status: 'failed', // 约课失败
                        updated_at: new Date().toISOString()
                    };
                    dbOperations.updateOrderFields(existingOrder.id, updateData);
                    console.log(`✅ 更新订单状态为失败: 订单ID ${existingOrder.id}`);
                }
                
                // 发送重新预约询问
                await sendRebookingQuestionToUser(userId, bookingSessionId);
            }
            
            console.log(`用户 ${userId} 确认约课未成功，预约会话 ${bookingSessionId}`);
        }
    } catch (error) {
        console.error('处理约课成功确认流程失败:', error);
    }
}

// 创建后台订单数据
async function createOrderData(bookingSession, userId, query) {
    try {
        const merchant = dbOperations.getMerchantById(bookingSession.merchant_id);
        const userFullName = `${query.from.first_name || ''} ${query.from.last_name || ''}`.trim() || '未设置名称';
        const username = query.from.username ? `@${query.from.username}` : '未设置用户名';
        
        // 确定课程内容和价格
        let courseContent = '';
        let price = '';
        
        switch (bookingSession.course_type) {
            case 'p':
                courseContent = 'p';
                price = merchant.p_price || '未设置';
                break;
            case 'pp':
                courseContent = 'pp';
                price = merchant.pp_price || '未设置';
                break;
            case 'other':
                courseContent = '其他时长';
                price = '其他';
                break;
        }
        
        // 创建订单数据 - 确保与商家绑定流程兼容
        const orderData = {
            booking_session_id: bookingSession.id,
            user_id: userId,
            user_name: userFullName,
            user_username: username,
            merchant_id: merchant.id,
            merchant_user_id: merchant.user_id, // 确保包含商家的真实用户ID
            teacher_name: merchant.teacher_name,
            teacher_contact: merchant.contact,
            course_type: bookingSession.course_type, // 确保课程类型正确
            course_content: courseContent,
            price_range: price,
            actual_price: null, // 实际价格待后续确定
            status: 'confirmed', // 约课成功
            user_evaluation: null, // 将来填入用户评价
            merchant_evaluation: null, // 将来填入商家评价
            report_content: null, // 将来填入报告内容
            created_at: Math.floor(Date.now() / 1000), // 使用Unix时间戳保持一致性
            updated_at: Math.floor(Date.now() / 1000)
        };
        
        // 保存到数据库
        const orderId = dbOperations.createOrder(orderData);
        
        console.log(`创建订单成功: 订单ID ${orderId}, 用户 ${userFullName} (${username}), 老师 ${merchant.teacher_name}, 课程 ${courseContent}`);
        
        return orderId;
        
    } catch (error) {
        console.error('创建订单数据失败:', error);
        throw error;
    }
}

// Bot用户名缓存
let cachedBotUsername = null;

// 动态获取Bot用户名
async function getBotUsername() {
    // 如果已有缓存，直接返回
    if (cachedBotUsername) {
        return cachedBotUsername;
    }
    
    // 优先使用环境变量
    if (process.env.BOT_USERNAME) {
        cachedBotUsername = process.env.BOT_USERNAME;
        console.log(`✅ 使用环境变量BOT_USERNAME: ${cachedBotUsername}`);
        return cachedBotUsername;
    }
    
    // 动态从Telegram API获取
    try {
        if (bot) {
            const botInfo = await bot.getMe();
            cachedBotUsername = botInfo.username;
            console.log(`✅ 动态获取Bot用户名成功: ${cachedBotUsername}`);
            return cachedBotUsername;
        }
    } catch (error) {
        console.error('❌ 动态获取Bot用户名失败:', error);
    }
    
    // 如果所有方法都失败，抛出错误
    throw new Error('无法获取Bot用户名：请设置BOT_USERNAME环境变量或确保Bot可用');
}

// 清除Bot用户名缓存（用于重新获取）
function clearBotUsernameCache() {
    cachedBotUsername = null;
}

module.exports = {
    bot,
    loadCacheData,
    sendMessageTemplate,
    checkTriggerWords,
    initBotHandlers,
    sendCourseCompletionCheck,
    sendRebookingQuestion,
    sendRebookingQuestionToUser,
    startMerchantEvaluation,
    startUserEvaluation,
    sendMessageWithDelete,
    sendMessageWithoutDelete,
    handleBackButton,
    getBotUsername,
    clearBotUsernameCache,
    // 获取Bot实例
    getBotInstance: () => bot,
    // 导出缓存数据的getter
    getCacheData: () => ({
        merchants,
        buttons,
        messageTemplates,
        triggerWords,
        scheduledTasks,
        bindCodes,
        regions
    })
}; 