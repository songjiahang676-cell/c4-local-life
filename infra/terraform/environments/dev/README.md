# dev

低成本团队集成；合成数据；可单 AZ/缩容但不共享 production state。

实现时此目录包含 backend 配置、环境变量文件（不含 secret）和 root module calls。State 使用独立加密远程后端与锁。
