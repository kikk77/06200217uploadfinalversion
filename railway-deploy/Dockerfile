# 使用Node.js 18 LTS版本
FROM node:18-alpine

# 安装必要的构建工具（用于编译better-sqlite3）
RUN apk add --no-cache \
    python3 \
    py3-pip \
    make \
    g++ \
    sqlite \
    sqlite-dev \
    && ln -sf /usr/bin/python3 /usr/bin/python

# 设置Python环境变量
ENV PYTHON=/usr/bin/python3

# 设置工作目录
WORKDIR /app

# 复制package文件
COPY package*.json ./

# 安装依赖
RUN npm install --only=production

# 复制源代码
COPY . .

# 创建数据目录
RUN mkdir -p data

# 暴露端口
EXPOSE 3000

# 启动命令
CMD ["npm", "start"] 