/************************************************
精简极致的均线策略 30行打造一个正向收益系统
没错！你听的没错是30行代码！仅仅30行小编我习惯先通篇来看看 代码，这样能有个宏观的了解！

策略参数如下
参数	描述	类型	默认值
FastPeriod	入市快线周期	数字型(number)	5
SlowPeriod	入市慢线周期	数字型(number)	15
EnterPeriod	入市观察期	数字型(number)	3
ExitFastPeriod	离市快线周期	数字型(number)	5
ExitSlowPeriod	离市慢线周期	数字型(number)	15
ExitPeriod	离市观察期	数字型(number)	1
PositionRatio	仓位比例	数字型(number)	0.8
Interval	轮询周期(秒)	数字型(number)	5

导入了 交易类库 方便策略编写， 不用为 是否买到 是否卖出等 挂单 烦恼了。
读代码的时候，发现未声明的变量感到迷惑时，到群里解答。

这个策略只有一个主函数function main(),没有其它的函数模块。主函数内只有一个循环。
小编我把这个策略的代码注释版已经传上QQ群共享了，初次学习的同学可以看看注释方便学习
这里没有加入官方QQ群的请加入：309368835 BotVS EA交流(BotVS)。策略就这么几十行代码，很精简吧！
为了照顾没有Javascript语言基础的同学我们在此简单讲下语法，以免有同学看不明白代码。

贴子地址：https://www.botvs.com/bbs-topic/262
视频教程地址：http://v.youku.com/v_show/id_XMTUyNDY1NjQ2NA==.html

************************************************/

function main() {
    var STATE_IDLE  = -1;
    var state = STATE_IDLE;
    var opAmount = 0;
    var initAccount = $.GetAccount();
    Log(initAccount);
    while (true) {
        if (state === STATE_IDLE) {
            var n = $.Cross(FastPeriod, SlowPeriod);
            if (Math.abs(n) >= EnterPeriod) {
                opAmount = parseFloat((initAccount.Stocks * PositionRatio).toFixed(3));
                var obj = n > 0 ? $.Buy(opAmount) : $.Sell(opAmount);
                if (obj) {
                    opAmount = obj.amount;
                    state = n > 0 ? PD_LONG : PD_SHORT;
                    Log("开仓详情", obj, "交叉周期", n);
                }
            }
        } else {
            var n = $.Cross(ExitFastPeriod, ExitSlowPeriod);
            if (Math.abs(n) >= ExitPeriod && ((state === PD_LONG && n < 0) || (state === PD_SHORT && n > 0))) {
                var obj = state === PD_LONG ? $.Sell(opAmount) : $.Buy(opAmount);
                state = STATE_IDLE;
                var nowAccount = $.GetAccount();
                LogProfit(nowAccount.Balance - initAccount.Balance, '钱:', nowAccount.Balance, '币:', nowAccount.Stocks, '平仓详情:', obj, "交叉周期", n);
            }
        }
        Sleep(Interval*1000);
    }
}