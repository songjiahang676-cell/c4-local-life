const metrics = [
  ["待审核信息", "126", "+18 今日"],
  ["待处理举报", "23", "4 高优先级"],
  ["活跃广告", "38", "7 天内到期 5"],
  ["今日新增用户", "318", "+12.6%"],
];

const queues = [
  ["房屋出租", 36],
  ["招聘招工", 29],
  ["店铺转让", 21],
  ["二手物品", 18],
  ["师傅服务", 12],
];

export default function AdminHome() {
  return (
    <main className="adminShell">
      <aside>
        <div className="adminBrand">
          ☀ <strong>南加生活网</strong>
        </div>
        <nav>
          {[
            "总览",
            "内容审核",
            "用户与组织",
            "商家与师傅",
            "举报与风控",
            "广告管理",
            "订单与积分",
            "分类与城市",
            "运营位配置",
            "系统设置",
            "审计日志",
          ].map((item, index) => (
            <a className={index === 0 ? "active" : ""} href="#" key={item}>
              {item}
            </a>
          ))}
        </nav>
      </aside>
      <section className="adminContent">
        <header>
          <div>
            <h1>运营总览</h1>
            <p>此页面是管理端架构骨架，功能按 tasks/EPICS.md 实现。</p>
          </div>
          <button type="button">管理员 ▾</button>
        </header>
        <div className="metrics">
          {metrics.map(([label, value, note]) => (
            <article key={label}>
              <span>{label}</span>
              <strong>{value}</strong>
              <small>{note}</small>
            </article>
          ))}
        </div>
        <div className="adminGrid">
          <section className="panel">
            <h2>审核队列</h2>
            {queues.map(([label, count]) => (
              <div className="queue" key={label}>
                <span>{label}</span>
                <b>{count}</b>
                <button type="button">查看</button>
              </div>
            ))}
          </section>
          <section className="panel">
            <h2>平台健康</h2>
            {[
              ["API 可用性", "99.98%"],
              ["搜索索引延迟", "18 秒"],
              ["任务队列积压", "42"],
              ["失败支付回调", "0"],
            ].map(([label, value]) => (
              <div className="health" key={label}>
                <span>{label}</span>
                <strong>{value}</strong>
              </div>
            ))}
          </section>
          <section className="panel wide">
            <h2>最近运营动作</h2>
            <table>
              <thead>
                <tr>
                  <th>时间</th>
                  <th>操作人</th>
                  <th>动作</th>
                  <th>对象</th>
                  <th>结果</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>10:42</td>
                  <td>moderator-01</td>
                  <td>通过审核</td>
                  <td>招聘 #LST-10283</td>
                  <td>成功</td>
                </tr>
                <tr>
                  <td>10:38</td>
                  <td>adops-02</td>
                  <td>更新广告排期</td>
                  <td>首页横幅</td>
                  <td>成功</td>
                </tr>
                <tr>
                  <td>10:31</td>
                  <td>support-03</td>
                  <td>冻结账号</td>
                  <td>user-8281</td>
                  <td>待复核</td>
                </tr>
              </tbody>
            </table>
          </section>
        </div>
      </section>
    </main>
  );
}
