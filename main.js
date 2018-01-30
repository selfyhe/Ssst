/************************************************
现货短信程序化操作策略1.0 2018-1-22
1.指数均线使用的是EMA线
2.判断当前正在操作的类型，如果正在操作类型不为NONE，继续操作原来的卖出或买入操作，直到全部操作完成。
3.如果继续操作类型为NONE，说明一个没有正在操作，操作流程序按以下三频来判断
31.当前交叉周期为0时：（两线相交的第一分钟）
	1）判断最后一次操作类型为-1时，说明软件刚刚打开，不知道是上升还是下降，不作处理
	2）判断最后一次操作类型为0时，说明当前进入下降通道，应该操作卖出流程 
	3）判断最后一次操作类型为1时，说明当前进入上升通道，应该操作买入流程
32.当前交叉周期为负数时（正在走下降通道），应该操作卖出流程
33.当前交叉周期为正数时（正在走上升通道）：
	1）判断最后一次操作类型为1或-1时（卖出或是新运行），应该操作买入流程
	2）判断最后一次操作类型为0时，说明是买入后继续上升，如果交易所当前买入价格1超过止盈点时，都进入卖出流程，一次卖控仓比例直到卖完，其他情况下都进入不作其他处理
4.买入流程:
	1）判断最后一次操作类型，如果是-1说明是初次买入，则尽量不在交叉周期大于5之后再买入；
	2）判断最后一次操作类型为1时，并且当前交叉周期为0时，如果当前买入价格1已经超过止盈点，则入市观察期调整为0，就是当即买入，否则还是按原来的设定的入市观察期
	3）买入一次性买入，按买入仓位比例参数，提交一次买入指令
5.卖出流程：
	1）判断最后一次操作类型为-1时，说明软件此时运行时刚好出现下降行情，因此不知道持仓价格；就不作处理（最好手动在运行软件之前保持没有持币状态）。
	----不用 2）判断卖出价格是否比大于或等于上次买入均价，没有达到就不卖，守币直到下一次卖出机会并符合条件
	3）如果当前交叉周期为0时，卖点刚刚出现，且当前交易所买入价格1已经超过止盈点，刚离市观察期调整为0，就是当即卖出。不然一分钟之后价格可以掉得很快
	4）卖出，按卖出币比例卖出，提交一次卖出指令
6.获取到交易订单状态后：
	1）如果成功卖出添加浮盈记录
	2）如果没有成功完成交易，取消订单，重新按当前价格下单

策略参数如下
参数	描述	类型	默认值
FastPeriod	入市快线周期	数字型(number)	5
SlowPeriod	入市慢线周期	数字型(number)	15
EnterPeriod	入市观察期	数字型(number)	3
ExitFastPeriod	离市快线周期	数字型(number)	5
ExitSlowPeriod	离市慢线周期	数字型(number)	15
ExitPeriod	离市观察期	数字型(number)	1
OperateFineness	买卖操作的粒度	数字型(number)	80
Interval	轮询周期(秒)	数字型(number)	5
************************************************/

//全局常数定义
//操作类型常量
var OPERATE_STATUS_NONE = -1;
var OPERATE_STATUS_BUY = 0; 
var OPERATE_STATUS_SELL = 1;


//全局变量设置
var lastBuyPrice = 0;	//保存最后一次卖入价
var lastSellPrice = 0;	//保存最后一次卖出价
var lastOrderId = 0;	//上一手订单编号
var operatingStatus = OPERATE_STATUS_NONE;	//正在操作的状态
var lastOperateType = OPERATE_STATUS_NONE;	//最后一次操作的类型，如果最后一次操作为-1，说明软件运行之后还没有操作过交易，如果ORDER_TYPE_BUY=0，ORDER_TYPE_SELL=1
var isCancelAllWS = true;  //退出时取消所有挂单
var isResetLogo = true;  //运行时生重置所有的日志

//判断当前均线周期，以分钟为单位
function getAverageCycle(){
	var ret = 1;
	var records = exchange.GetRecords();
	var timediff = records[1].Time - records[0].Time;
	ret = timediff/(60*1000);
	return ret;
}

//根据均线周期决定开始止盈的时间起点
function getTargetProfit(cycleminite){
	var profit = 1.1;
	switch(cycleminite){
		case 1:
			profit = 1.01;
			break;
		case 5:
			profit = 1.05;
			break;
		case 10:
			profit = 1.1;
			break;
		case 15:
			profit = 1.15;
			break;
		case 30:
			profit = 1.20;
			break;
		case 60:
			profit = 1.25;
			break;
	}
	return profit;
}

//检测卖出订单是否成功
function checkSellFinish(){
	var order = exchange.GetOrder(lastOrderId);
	if(order.Status === ORDER_STATE_CLOSED ){
		var profit = order.AvgPrice - lastBuyPrice;
		Log("订单",lastOrderId,"交易成功!平均卖出价格：",order.AvgPrice,"，买入价格：",lastBuyPrice,"，浮动盈利：",profit);
		LogProfit(profit);
		//设置最后一次卖出价格
		lastSellPrice = order.AvgPrice;
	}else if(order.Status === ORDER_STATE_PENDING ){
		if(order.DealAmount){
			Log("订单",lastOrderId,"部分成交!卖出数量：",order.DealAmount,"，剩余数量：",order.Amount - order.DealAmount);
			var profit = order.AvgPrice - lastBuyPrice;
			LogProfit(profit);
			//设置最后一次卖出价格
			lastSellPrice = order.AvgPrice;
		}else{
			Log("订单",lastOrderId,"未有成交!卖出价格：",order.Price,"，当前买一价：",exchange.GetTicker().Buy,"，价格差：",order.Price - exchange.GetTicker().Buy);
		}
		//撤消没有完成的订单
		exchange.CancelOrder(lastOrderId);
		Log("取消卖出订单：",lastOrderId);
		Sleep(1300);
	}
}

//检测买入订单是否成功
function checkBuyFinish(){
	var order = exchange.GetOrder(lastOrderId);
	if(order.Status === ORDER_STATE_CLOSED ){
		Log("买入订单",lastOrderId,"交易成功!订单买入价格：",order.Price,"，平均买入价格：",order.AvgPrice,"，买入数量：",order.DealAmount);
		//设置最后一次买入价格
		lastBuyPrice = order.AvgPrice;
	}else if(order.Status === ORDER_STATE_PENDING ){
		if(order.DealAmount){
			Log("买入订单",lastOrderId,"部分成交!订单买入价格：",order.Price,"，平均买入价格：",order.AvgPrice,"，买入数量：",order.DealAmount);
			//设置最后一次买入价格
			lastBuyPrice = order.AvgPrice;
		}else{
			Log("买入订单",lastOrderId,"未有成交!订单买入价格：",order.Price,"，当前卖一价：",exchange.GetTicker().Sell,"，价格差：",order.Price - exchange.GetTicker().Sell);
		}
		//撤消没有完成的订单
		exchange.CancelOrder(lastOrderId);
		Log("取消买入订单：",lastOrderId);
		Sleep(1300);
	}
}

// 取消所有挂单 函数
function cancelPending() { 
    Log("操作取消所有挂单。");                                 
    var ret = false;                                            // 设置 返回成功  标记变量
    while (true) {                                              // while 循环
        if (ret) {                                              // 如果 ret 为 true 则 Sleep 一定时间
            Sleep(1300);
        }
        var orders = _C(exchange.GetOrders);                    // 调用  API 获取 交易所 未完成的订单信息
        if (orders.length == 0) {                               // 如果返回的是  空数组， 即 交易所 没有未完成的订单。
            break;                                              // 跳出 while 循环
        }

        for (var j = 0; j < orders.length; j++) {               // 遍历 未完成的 订单数组， 并根据索引j 逐个使用  orders[j].Id 去 取消订单。
            exchange.CancelOrder(orders[j].Id, orders[j]);
			Log("取消订单：",orders[j].Id); 
            ret = true;                                         // 一旦有取消操作， ret 赋值 为 true 。用于触发 以上 Sleep ， 等待后重新 exchange.GetOrders 检测 
        }
    }
    return ret;                                                 // 返回 ret
}

//程序运行时重置所有的日志
function init(){
	if (isResetLogo) {                                 // RestData 为界面参数， 默认 true ， 控制 启动时 是否清空所有数据。默认全部清空。
        LogProfitReset();                            // 执行 API LogProfitReset 函数，清空 所有收益。
        LogReset();                                  // 执行 API LogReset 函数， 清空 所有日志。
    }
}

// 程序 退出 时的收尾函数。
function onexit() {                             
    if (isCancelAllWS) {                          // 设置了 停止时取消所有挂单，则 调用 cancelPending() 函数 取消所有挂单
        Log("正在退出, 尝试取消所有挂单");
        cancelPending();
    }
    Log("策略成功停止");
    Log(_C(exchange.GetAccount));               // 打印退出程序时的  账户持仓信息。
}

//主程序函数
function main() {
	Log("启动数字货币现货交易正向收益策略程序...");  
	//获取止盈止损点，不同K线周期的情况下，止盈止损点不一样。
	var cycleminite = getAverageCycle();
	var profit = getTargetProfit();
	Log("根据当前K线周期",cycleminite,"，当前的止盈止损点为",profit);  

	//主操作循环
    while (true) {
		//交易买卖操作相关变量
		var opAmount = 0;
		var obj = null;
		var isOperated = false;		
		var willOperateType = OPERATE_STATUS_NONE;	//准备操作的类型,根据此变量的值来选择操作流程
		
		//检测上一个订单，成功就改状态，不成功就取消重新发
		if(lastOrderId && operatingStatus != OPERATE_STATUS_NONE){
			if(operatingStatus > OPERATE_STATUS_BUY){
				checkSellFinish()
			}else{
				checkBuyFinish();
			}
			//刚才上一次订单ID清空，不再重复判断
			lastOrderId = 0;
		}

		//重新获取帐号信息，显示当前仓位信息
		initAccount = exchange.GetAccount();
		Log("当前帐号信息，资金：",initAccount.Balance,"，持币：",initAccount.Stocks,"，冻结资金：",initAccount.FrozenBalance,"，冻结币：",initAccount.FrozenStocks);		
		
		//判断并选择操作流程
		if(operatingStatus != OPERATE_STATUS_NONE){
			//上一个买入卖出的操作还没有操作完成，继续操作
			willOperateType = operatingStatus;
			var msg = willOperateType == OPERATE_STATUS_BUY ? "买入" : "卖出";
			Log(msg,"操作还没有完成，继续直接操作",msg,"流程。");
		}else{			
			//分析交叉周期数
			var crossPeriod = $.Cross(FastPeriod, SlowPeriod);
			Log("获取行情成功，开始分析行情...");  
			//上一个买入卖出的操作已经完成，需要观察情况
			if(crossPeriod === 0){
				//当前两条均线刚刚交叉
				//1）判断最后一次操作类型为-1时，说明软件刚刚打开，不知道是上升还是下降，不作处理
				//2）判断最后一次操作类型为0时（买入），说明当前进入下降通道，应该操作卖出流程 
				//3）判断最后一次操作类型为1时（卖出），说明当前进入上升通道，应该操作买入流程
				if(lastOperateType == OPERATE_STATUS_BUY){
					//进入下降通道
					willOperateType = OPERATE_STATUS_SELL;
					Log("当前快慢均线交叉，死叉出现了，上一次操作了买入，现在适合操作卖出注程。"); 
				}else if(lastOperateType == OPERATE_STATUS_SELL){
					//进入上升通道
					willOperateType = OPERATE_STATUS_BUY;
					Log("当前快慢均线交叉,金叉出现了，上一次操作了卖出，现在适合操作买入注程。"); 
				}	
			}else if(crossPeriod < 0){
				//当前交叉周期为负数时（正在走下降通道），应该操作卖出流程
				willOperateType = OPERATE_STATUS_SELL;
				Log("当前处于下降通道，下穿数为",crossPeriod,"，现在适合操作卖出注程。"); 
			}else{
				//当前交叉周期为正数时（正在走上升通道）
				//1）判断最后一次操作类型为1或-1时（卖出或是新运行），应该操作买入流程
				//2）判断最后一次操作类型为0时，说明是买入后继续上升，如果交易所当前买入价格1超过止盈点，都进入卖出流程，其他情况下都进入不作其他处理
				if(lastOperateType == OPERATE_STATUS_BUY){
					//判断最后一次操作类型为0时，说明是买入后继续上升
					//判断是否价格超过止盈点
					var profitrate = exchange.GetTicker().Buy/lastBuyPrice;
					if(profitrate >= profit){
						//当前价超过买入价已经超过止盈点，操作卖出
						willOperateType = OPERATE_STATUS_SELL;
						Log("当前强势上升，当前价：",exchange.GetTicker().Buy,"，已经超过买入价：",lastBuyPrice,"的止盈点",profit,"，操作卖出流程。"); 
					}else{
						Log("当前依然是上升通道，当前价：",exchange.GetTicker().Buy,"，未超买入价：",lastBuyPrice,"的止盈点",profit,"，继续观望。"); 
					}
				}else{
					//判断最后一次操作类型为1或-1时（卖出或是新运行），应该操作买入流程
					willOperateType = OPERATE_STATUS_BUY;
					if(lastOperateType == OPERATE_STATUS_SELL){
						Log("当前处于上升通道，上一次操作了卖出等待买入机会出现，上穿数为",crossPeriod,"，现在适合操作买入流程。"); 
					}else{
						Log("当前正在上升通道，软件刚刚开启，上穿数为",crossPeriod,"，现在适合操作买入流程。");
					}
				}
			}
		}
		
		//进入买卖业务流程
		if(willOperateType == OPERATE_STATUS_BUY){
			//进入买入流程
			//1）判断最后一次操作类型，如果是-1说明是初次买入，则尽量不在交叉周期大于5之后再买入；
			//2）判断最后一次操作类型为1时，并且当前交叉周期为0时，如果当前买入价格1比上一次卖出价格的下降了超过5%，则入市观察期调整为0，就是当即买入，否则还是按原来的设定的入市观察期
			//3）买入一次性买入，按买入仓位比例参数，提交一次买入指令
			//根据情况调整入市观察期
			var tmpEnterPeriod = EnterPeriod
			if(willOperateType === operatingStatus){
				//当前正在操作买入，继续操作
				tmpEnterPeriod = 0;
			}else{
				//刚刚开始准备买入
				if(lastOperateType == OPERATE_STATUS_NONE){
					//最后一次操作类型，如果是-1说明是初次买入
					if(crossPeriod >= 5){
						tmpEnterPeriod = 9999;
						Log("没有操作过卖出之前，运行后已经连续上涨了五个K线以上，不再适合买入，入市观察期调整为9999。"); 
					}
				}else{
					//上一次卖完，现在准备买入
					//最后一次操作类型为1时,判断价格下跌情况
					var profitbuy = lastSellPrice/exchange.GetTicker().Sell;
					if(crossPeriod === 0 && profitbuy >= profit){
						tmpEnterPeriod = 0;
						Log("较上一次卖出价格，现在已经下跌足够止盈点，买入机会进来了，第一时间操作买入。"); 
					}
				}
			}
			if (crossPeriod >= tmpEnterPeriod) {
				Log("当前为上升通道，上穿数为",crossPeriod,"，入市观察期为",tmpEnterPeriod,"，买入机会来了，准备买入操作，每次买入的粒度为",OperateFineness); 
				var tmpPayFee = OperateFineness*exchange.GetTicker().Sell
				if(initAccount.Balance <= tmpPayFee) tmpPayFee = initAccount.Balance-0.01;
				opAmount = parseFloat(tmpPayFee).toFixed(2);
				if(opAmount > 0.01){
					Log("准备以当前价格买入，买入金额为",opAmount,"，当前卖1价格为",exchange.GetTicker().Sell); 
					obj = $.Buy(opAmount);
					operatingStatus = OPERATE_STATUS_BUY;
					isOperated = true;
				}else{
					Log("买币操作已经完成，已经全部买进。" ); 
					//修改最后一次操作的类型
					lastOperateType = ORDER_TYPE_BUY;
					//重置订单操作状态
					operatingStatus = OPERATE_STATUS_NONE;	
				}
			}else{
				Log("当前处于上升通道，上穿数为",crossPeriod,"，< 入市观察期",tmpEnterPeriod,"，等待买入机会出现。"); 
			}
		}else if(willOperateType == OPERATE_STATUS_SELL){
			//卖出流程：
			//1）判断最后一次操作类型为-1时，说明软件此时运行时刚好出现下降行情，因此不知道持仓价格；就不作处理（最好手动在运行软件之前保持没有持币状态）。
			//2）如果当前交叉周期为0时，卖点刚刚出现，且当前交易所买入价格1高于买入价格的5%以上，刚离市观察期调整为0，就是当即卖出。不然一分钟之后价格可以掉得很快
			//3）卖出，按卖出币比例卖出，提交一次卖出指令
			var tmpExitPeriod = ExitPeriod
			if(willOperateType === operatingStatus){
				//当前正在操作卖出，继续操作
				tmpExitPeriod = 0;
			}else{
				//刚刚开始准备卖出
				if(lastOperateType == OPERATE_STATUS_NONE){
					//最后一次操作类型为-1时，说明软件此时运行时刚好出现下降行情，因此不知道持仓价格；就不作处理
					tmpExitPeriod = 9999;
					Log("当前处于下降通道，策略运行之后没有买入过，不知道买入价格不能随便卖出，入市观察期调整为9999。"); 
				}else{
					//判断交叉周期决定是否要快速卖出,判断价格下跌情况
					var profitsell = exchange.GetTicker().Buy/lastBuyPrice;
					if(crossPeriod === 0 && profitsell >= profit){
						tmpExitPeriod = 0;
						Log("卖点出现，当前交易所买入价格1高于止盈点，第一时间操作卖出。"); 
					}
				}
			}
			if (Math.abs(crossPeriod) >= tmpExitPeriod) {
				Log("行情下在为下行通道，下穿数为",crossPeriod,"，>= 离市观察期",tmpExitPeriod,"，准备卖出操作。"); 
				opAmount = initAccount.Stocks > OperateFineness? OperateFineness : parseFloat(initAccount.Stocks-0.01).toFixed(2);
				if(opAmount > 0.01){
					Log("准备以当前价格卖出，卖出数量为",opAmount,"，当前买1价格为",exchange.GetTicker().Buy); 
					obj = $.Sell(opAmount);
					operatingStatus = OPERATE_STATUS_SELL;
					isOperated = true;
				}else{
					Log("卖币操作完成，持仓已经清空。" ); 
					//修改最后一次操作的类型
					lastOperateType = ORDER_TYPE_SELL;
					//重置订单操作状态
					operatingStatus = OPERATE_STATUS_NONE;
				}
			}else{
				Log("当前均线下穿数为：",crossPeriod," < 离市观察期：",tmpExitPeriod,"，不做操作保持观察。"); 
			}
		}
		//判断并输出操作结果
		if(isOperated){
			if (obj) {
				//保存最后订单编号
				lastOrderId = isNaN(obj) ? obj.Id : obj;
				Log("订单发送成功，订单编号：",lastOrderId,"，订单详情：", obj);
			}else{
				Log("订单发送失败，obj=", obj);
			}
		}
		//暂停指定时间
        Sleep(Interval*1000);
    }
}
