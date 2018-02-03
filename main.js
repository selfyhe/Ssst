/************************************************
现货短线程序化操作策略v1.2 2018-1-29 调整下行通道时止盈卡损点算法
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
	3）买入的时候根据当前币种的限仓金额买入，每次买入的最大数量不超过买卖操作粒度，以防止过大的单成交时间过长
	4）如果买入金额过大就会多次连续买入，直到买入操作完成
5.卖出流程：
	1）判断最后一次操作类型为-1时，说明软件此时运行时刚好出现下降行情，因此不知道持仓价格；就不作处理（最好手动在运行软件之前保持没有持币状态）。
	2）添加止盈卖出的仓位控制，控制在75%，余下25%等后面再退出。
	3）如果当前交叉周期为0时，卖点刚刚出现，且当前交易所买入价格1已经超过止盈点，刚离市观察期调整为0，就是当即卖出。不然一分钟之后价格可以掉得很快
	4）卖出，按卖出币比例卖出，提交一次卖出指令
6.获取到交易订单状态后：
	1）如果成功卖出添加浮盈记录
	2）如果没有成功完成交易，取消订单，重新按当前价格下单

策略参数如下
参数	描述	类型	默认值
FastPeriod	快线周期	数字型(number)	5
SlowPeriod	慢线周期	数字型(number)	15
EnterPeriod	入市观察期	数字型(number)	3
ExitPeriod	离市观察期	数字型(number)	1
OperateFineness	买卖操作的粒度	数字型(number)	80
BalanceLimit	买入金额数量限制	数字型(number)	300
NowCoinPrice	当前持币价格		数字型(number)	0
MinStockAmount	限价交易最小交易数量		数字型(number)	1
SlidePriceNum	下单滑动价		数字型(number)	0.0001
BuyFee	平台买入手续费		数字型(number)	0.002
SellFee	平台卖出手续费		数字型(number)	0.002
MAType	均线算法	下拉框(selected)	EMA|MA|AMA(自适应均线)
DefaultProfit 默认止损点	数字型(number)	0.05
DebugMode	是否调试模式		下拉框型	0|1
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
var canTargetProfitNum = 0;	//可止盈卖出量
var doingTargetProfitSell = false;	//正在操作止盈卖出
var buyTotalPay = 0;	//购买累计支付金额
var PriceDecimalPlace = 2;	//价格小数位数
var StockDecimalPlace = 2;	//交易数量小数位数

//获取当前行情
function GetTicker() {
    return _C(exchange.GetTicker);
}

//获取帐户信息
function GetAccount() {
    return _C(exchange.GetAccount);
}

//获得价格的小数位数
function getPriceDecimalPlace() {
    return GetTicker().Last.toString().split(".")[1].length;
}
//获得交易量的小数位数
function getStockDecimalPlace() {
	return exchange.GetMinStock().toString().split(".")[1].length;
}


//获取当前行前的振幅
function getPriceAmplitude(){
	var ret = 0.002;
	var symbol = exchange.GetCurrency();
	symbol = symbol.replace("_","");
	symbol = symbol.toLowerCase();
	var obj = exchange.IO("api", "GET", "/market/detail", "symbol="+symbol);
	if(obj){
		ret = _N((obj.tick.high-obj.tick.low)/obj.tick.high,3)
		Log("当前价：",obj.tick.close,"最高价：",obj.tick.high,"，最低价：",obj.tick.low,"，上下振幅：",ret);
	}
	return ret;
}

//根据行性数字序列获取线性趋势，大于1为上升通道，小于1为下降通道
function getLinearTrend(linearray){
    var trend = 1;
    var sub = 0;
    if(linearray && linearray.length>=2){
        for(var i=1;i<=linearray.length-1;i++){
            sub += linearray[i]/linearray[i-1];
        }
        trend = sub/(linearray.length-1);
    }
    return trend;
}

//获得当前10个小时之内的收盘价数字序列
function getQuotation(){
    var recrods = _C(exchange.GetRecords,PERIOD_H1);
    var quotations = null;
    if(recrods && recrods.length>=2){
        quotations = recrods.length<10 ? new Array(recrods.length) : new Array(10);
        var j=0;
        for(var i=recrods.length-quotations.length;i<=recrods.length-1;i++){
            quotations[j] = recrods[i].Close;
            j++;
        }
    }
    return quotations;
}


//根据均线周期决定及最近10小时的行情线性变化，开始止盈的时间起点
//如果行情是下行通道5个点就可以了，如果是上行通道，那按振幅来算出来
function getTargetProfit(lineartrend,pa,lastprofit){
	var profit = DefaultProfit;
	//var lineartrend = getLinearTrend(getQuotation());
	if(lineartrend>1){
		var minprofit = 0.010;
		var maxprofit = 0.501;
		profit = parseFloat((pa/2+1).toFixed(3));
		profit = Math.max(profit, minprofit);
		profit = Math.min(profit, maxprofit);
	}else if(lineartrend === 1){
        profit = lastprofit;
    }
	return profit;
}

//检测卖出订单是否成功
function checkSellFinish(crossperiod){
    var ret = true;
	var Ticker = GetTicker();
	var order = exchange.GetOrder(lastOrderId);
	if(order.Status === ORDER_STATE_CLOSED ){
		var profit = (order.AvgPrice - lastBuyPrice)*order.DealAmount*(1-SellFee-BuyFee);
		Log("订单",lastOrderId,"交易成功!平均卖出价格：",order.AvgPrice,"，买入价格：",lastBuyPrice,"，浮动盈利：",profit);
		LogProfit(profit);
		//设置最后一次卖出价格
		lastSellPrice = order.AvgPrice;
	}else if(order.Status === ORDER_STATE_PENDING ){
        //如果依然在下行通道，判断价格变化是否超过止损点，如果没有就继续挂单不取消
        var sellprofit = (lastBuyPrice-Ticker.Buy)/lastBuyPrice;
        if(order.DealAmount === 0 && crossperiod < 0 && sellprofit < 0.05){
            Log("挂单",lastOrderId,"未有成交,市场行情没有太大变化，依然下行，当前价与挂单价",order.Price,"变化不大，继续保持挂单。");
            ret = false;
        }else{
		    if(order.DealAmount){
			    Log("订单",lastOrderId,"部分成交!卖出数量：",order.DealAmount,"，剩余数量：",order.Amount - order.DealAmount);
			    var profit = (order.AvgPrice - lastBuyPrice)*order.DealAmount*(1-SellFee-BuyFee);
			    LogProfit(profit);
			    //设置最后一次卖出价格
			    lastSellPrice = order.AvgPrice;
		    }else{
			    Log("订单",lastOrderId,"未有成交!卖出价格：",order.Price,"，当前买一价：",Ticker.Buy,"，价格差：",_N(order.Price - Ticker.Buy, PriceDecimalPlace));
		    }
		    //撤消没有完成的订单，如果交叉周期在5以内不急着取消挂单        
		    exchange.CancelOrder(lastOrderId);
		    Log("取消卖出订单：",lastOrderId);
		    Sleep(1300);
        }
	}
    return ret;
}

//检测买入订单是否成功
function checkBuyFinish(){
	var Ticker = GetTicker();
	var order = exchange.GetOrder(lastOrderId);
	if(order.Status === ORDER_STATE_CLOSED ){
		Log("买入订单",lastOrderId,"交易成功!订单买入价格：",order.Price,"，平均买入价格：",order.AvgPrice,"，买入数量：",order.DealAmount);
		//设置最后一次买入价格
		lastBuyPrice = order.AvgPrice;
		//累加成交价格
		buyTotalPay += order.AvgPrice*order.DealAmount;
	}else if(order.Status === ORDER_STATE_PENDING ){
		if(order.DealAmount){
			Log("买入订单",lastOrderId,"部分成交!订单买入价格：",order.Price,"，平均买入价格：",order.AvgPrice,"，买入数量：",order.DealAmount);
			//设置最后一次买入价格
			lastBuyPrice = order.AvgPrice;
			//累加成交价格
			buyTotalPay += order.AvgPrice*order.DealAmount;
		}else{
			Log("买入订单",lastOrderId,"未有成交!订单买入价格：",order.Price,"，当前卖一价：",Ticker.Sell,"，价格差：",_N(order.Price - Ticker.Sell, PriceDecimalPlace));
		}
		//撤消没有完成的订单
		exchange.CancelOrder(lastOrderId);
		Log("取消买入订单：",lastOrderId);
		Sleep(1300);
	}
}

//程序运行时重置所有的日志
function init(){
	if (isResetLogo) {                                 // RestData 为界面参数， 默认 true ， 控制 启动时 是否清空所有数据。默认全部清空。
        //LogProfitReset();                            // 执行 API LogProfitReset 函数，清空 所有收益。
        LogReset();                                  // 执行 API LogReset 函数， 清空 所有日志。
    }
}

// 程序 退出 时的收尾函数。
function onexit() {                             
    if (isCancelAllWS && lastOrderId) {                          // 设置了 停止时取消所有挂单，则 调用 cancelPending() 函数 取消所有挂单
        Log("正在退出, 尝试取消上一个订单");
        exchange.CancelOrder(lastOrderId);
    }
    Log("策略成功停止");
    Log(_C(exchange.GetAccount));               // 打印退出程序时的  账户持仓信息。
}

// 返回上穿的周期数. 正数为上穿周数, 负数表示下穿的周数, 0指当前价格一样
function Cross(a, b) {
    var pfnMA = [TA.EMA, TA.MA, talib.KAMA][MAType];
    var crossNum = 0;
    var arr1 = [];
    var arr2 = [];
    if (Array.isArray(a)) {
        arr1 = a;
        arr2 = b;
    } else {
        var records = null;
        while (true) {
            records = exchange.GetRecords();
            if (records && records.length > a && records.length > b) {
                break;
            }
            Sleep(1000);
        }
        arr1 = pfnMA(records, a);
        arr2 = pfnMA(records, b);
    }
    if (arr1.length !== arr2.length) {
        throw "array length not equal";
    }
    for (var i = arr1.length-1; i >= 0; i--) {
        if (typeof(arr1[i]) !== 'number' || typeof(arr2[i]) !== 'number') {
            break;
        }
        if (arr1[i] < arr2[i]) {
            if (crossNum > 0) {
                break;
            }
            crossNum--;
        } else if (arr1[i] > arr2[i]) {
            if (crossNum < 0) {
                break;
            }
            crossNum++;
        } else {
            break;
        }
    }
    return crossNum;
}

//主程序函数
function main() {
	Log("启动数字货币现货交易正向收益策略程序...");  

	//获取价格及交易量的小数位
    PriceDecimalPlace = getPriceDecimalPlace();
    StockDecimalPlace = getStockDecimalPlace();
    //设置小数位，第一个为价格小数位，第二个为数量小数位
    exchange.SetPrecision(PriceDecimalPlace, StockDecimalPlace);
	Log("设置了交易平台价格小数位为",PriceDecimalPlace,"数额小数位为",StockDecimalPlace);  

	//获取止盈止损点，不同K线周期的情况下，止盈止损点不一样。
	if(NowCoinPrice > 0){
        lastBuyPrice = NowCoinPrice;
        lastOperateType = OPERATE_STATUS_BUY;
    }
	
	var targetProfit;	//定义止盈止损点
	
	//主操作循环
    while (true) {
		//获取上一次取行情的时间点
		var now = new Date().getTime();
		var ts = _G("LastGetPA") ? _G("LastGetPA") : now;
		var nowdiff = now - ts;
		if(nowdiff===0 || nowdiff > 60*60*1000){
			//写入当前时间戳
			_G("LastGetPA", now);
			//判断最近10小时是处于涨市还是跌市，如果是跌市就不操作
			var lineartrend = getLinearTrend(getQuotation());
			if(lineartrend<1){
				Log("过往10个小时行情处于下跌行情，先不操作一个小时后再看，等行情好再操作。");
				Sleep(60*60*1000);
				continue;	
			}		
			var pa = getPriceAmplitude();
			Log("重新取得振幅",pa);
			targetProfit = getTargetProfit(lineartrend, pa, targetProfit);
			if(pa < 0.002 && !DebugMode){
				Log("当前行情振幅太小，只有",pa,"，赚得不够手续费，暂时不操作，一小时之后再看。");
				Sleep(60*60*1000);
				continue;			
			}
			Log("当前行情振幅：",pa,"，止盈止损点：",targetProfit,"，限制持仓金额：",BalanceLimit,"，买卖操作粒度：",OperateFineness,"，交易价格小数位：",PriceDecimalPlace,"，交易数量小数位：",StockDecimalPlace,"，最小交易量：",MinStockAmount);  
		}
		
		//交易买卖操作相关变量
		var opAmount = 0;
		var orderid = 0;
		var isOperated = false;		
		var willOperateType = OPERATE_STATUS_NONE;	//准备操作的类型,根据此变量的值来选择操作流程
        var operateinterval = Interval;
        
        //获得交叉周期数
        var crossPeriod = Cross(FastPeriod, SlowPeriod);
		
		//检测上一个订单，成功就改状态，不成功就取消重新发
		if(lastOrderId && operatingStatus != OPERATE_STATUS_NONE){
			if(operatingStatus > OPERATE_STATUS_BUY){
				var finish = checkSellFinish(crossPeriod);
                if(!finish){
                    //暂停指定时间
                    Sleep(60*1000);
                    continue;
                }
			}else{
				checkBuyFinish();
			}
			//刚才上一次订单ID清空，不再重复判断
			lastOrderId = 0;
		}

		//获取实时信息
		var initAccount = GetAccount();
		var Ticker = GetTicker();
		Log("账户余额", initAccount.Balance, "，冻结余额", initAccount.FrozenBalance, "可用币数", initAccount.Stocks, "，冻结币数", initAccount.FrozenStocks, "，持仓价格：",lastBuyPrice, "，当前币价", Ticker.Sell );

        //判断行情是否发生了反转，如果是取消原来的操作
        if(crossPeriod > 0 && operatingStatus == OPERATE_STATUS_SELL || crossPeriod < 0 && operatingStatus == OPERATE_STATUS_BUY){
            operatingStatus = OPERATE_STATUS_NONE;
            Log("行情发生反转，取消原来的操作流程。");
        }
		
		//判断并选择操作流程
		if(operatingStatus != OPERATE_STATUS_NONE){
			//上一个买入卖出的操作还没有操作完成，继续操作
			willOperateType = operatingStatus;
			var msg = willOperateType == OPERATE_STATUS_BUY ? "买入" : "卖出";
			Log(msg,"操作还没有完成，继续直接操作",msg,"流程。");
		}else{			
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
					var profitrate = Ticker.Buy/lastBuyPrice;
					if(profitrate >= targetProfit){
						//当前价超过买入价已经超过止盈点，操作卖出
						willOperateType = OPERATE_STATUS_SELL;
						//开始操作止盈卖出
						doingTargetProfitSell = true;
						Log("当前强势上升，上穿数为",crossPeriod,"，当前价：",Ticker.Buy,"，已经超过买入价：",lastBuyPrice,"的止盈点",targetProfit,"，操作卖出流程。"); 
					}else{
						Log("当前依然是上升通道，上穿数为",crossPeriod,"，当前价：",Ticker.Buy,"，未超买入价：",lastBuyPrice,"的止盈点",targetProfit,"，继续观望。"); 
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
					if(crossPeriod >= 6){
						tmpEnterPeriod = 9999;
						Log("没有操作过卖出之前，运行后已经连续上涨了五个K线以上，不再适合买入，入市观察期调整为9999。"); 
					}
				}else{
					//上一次卖完，现在准备买入
					//最后一次操作类型为1时,判断价格下跌情况
					var profitbuy = lastSellPrice/Ticker.Sell;
					if(crossPeriod <= 1 && profitbuy >= targetProfit){
						tmpEnterPeriod = 0;
						Log("较上一次卖出价格，现在已经下跌足够止盈点，买入机会进来了，第一时间操作买入。"); 
					}else{
						//当前价格没有如果没有超过千万之二，暂不入市，入市观察期调为9999;
                        if(crossPeriod > 5){
                            tmpEnterPeriod = 9999;
							Log("当前为上升通道，上穿数为",crossPeriod," > 5 已经错最佳的买入机会，继续观察行情。"); 
                        }
					}
				}
				
			}
			if (crossPeriod >= tmpEnterPeriod) {
				Log("当前为上升通道，上穿数为",crossPeriod,"，入市观察期为",tmpEnterPeriod,"，买入机会来了，准备买入操作，每次买入的粒度为",OperateFineness); 
				//火币现货Buy()参数是买入个数，不是总金额
				var canpay = BalanceLimit - buyTotalPay;
				if(initAccount.Balance < canpay){
					canpay = initAccount.Balance;
				}
				var canbuy = canpay/Ticker.Sell;
				opAmount = canbuy > OperateFineness? OperateFineness : canbuy;
				opAmount = _N(opAmount, StockDecimalPlace);
				if(opAmount > MinStockAmount){
					Log("准备买入，限仓金额：",canpay,"，可买金额:",canpay,"，可买数量：",canbuy,"，本次买入数量:",opAmount,"，当前卖1价格:",Ticker.Sell); 
					orderid = exchange.Buy(Ticker.Sell,opAmount);
					operatingStatus = OPERATE_STATUS_BUY;
					isOperated = true;
				}else{
					//修改最后一次操作的类型
					lastOperateType = operatingStatus;
					//重置订单操作状态
					operatingStatus = OPERATE_STATUS_NONE;	
					Log("买币操作已经完成，已经全部买进，累计买入金额：",buyTotalPay,"，继续观察行情。" ); 
					//重置成交累计价格
					buyTotalPay = 0;
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
				if(lastOperateType == OPERATE_STATUS_NONE && lastBuyPrice === 0){
					//最后一次操作类型为-1时，说明软件此时运行时刚好出现下降行情，因此不知道持仓价格；就不作处理
					tmpExitPeriod = 9999;
					Log("当前处于下降通道，策略运行之后没有买入过，不知道买入价格不能随便卖出，入市观察期调整为9999。"); 
				}else{
					//判断交叉周期决定是否要快速卖出,判断价格下跌情况
					var profitsell = Ticker.Buy/lastBuyPrice;
					if(crossPeriod === 0 && profitsell >= targetProfit){
						tmpExitPeriod = 0;
						Log("卖点出现，当前交易所买入价格1高于止盈点，第一时间操作卖出。"); 
					}
				}
			}
			//如果是上行通道的止盈操作，保留25%的仓位，如果是下行清仓，就清到完。
			if(doingTargetProfitSell){
				Log("行情在上行通道说明是止盈操作，进行部份卖出，保留25%的仓位，准备卖出操作。"); 
				if(canTargetProfitNum === 0) canTargetProfitNum = initAccount.Stocks*0.75;
				opAmount = canTargetProfitNum > OperateFineness? OperateFineness : _N(canTargetProfitNum,StockDecimalPlace);
				if(opAmount > MinStockAmount){
					var price = exchange.GetDepth().Asks[2].Price+SlidePriceNum;
					Log("准备以当前卖出价格3上浮滑价止盈挂单卖出，挂单数量为",opAmount,"，价格为",price); 
					orderid = exchange.Sell(price,opAmount);
					operatingStatus = OPERATE_STATUS_SELL;
					isOperated = true;
                    //挂单价格较高，调整操作频率为60秒
                    operateinterval = 60;
				}else{
					//止盈卖出操作完成
					doingTargetProfitSell = false;
					//重置订单操作状态
					operatingStatus = OPERATE_STATUS_NONE;
					Log("止盈卖币操作完成，持币量已经降到",initAccount.Stocks,"，继续观察行情。" ); 
				}
			}else{
				//下行通道卖出
				if (Math.abs(crossPeriod) >= tmpExitPeriod) {
					Log("行情下在为下行通道，下穿数为",crossPeriod,"，>= 离市观察期",tmpExitPeriod,"，准备卖出操作。"); 
					opAmount = initAccount.Stocks > OperateFineness? OperateFineness : _N(initAccount.Stocks,StockDecimalPlace);
					if(opAmount > MinStockAmount){
                        //分析当前应该用什么价格来卖出，这个时候卖出价格不参用_N函数来计算，不然就会亏了。价格也不要设得刚刚好，多加上手续费好点
                        var maxsellprice = parseFloat((Math.max(Ticker.Buy,lastBuyPrice*(1+SellFee*2+BuyFee))).toFixed(PriceDecimalPlace));
                        var sellprofit = (lastBuyPrice-Ticker.Buy)/lastBuyPrice;
                        if(sellprofit > DefaultProfit){
                            //如果当前价格已经跌下默认止损点，止损退出
                            maxsellprice = Ticker.Buy;
                            Log("当前价已经跌超买入价的",sellprofit,"> 默认止损点",DefaultProfit," 进行止损卖出，数量为",opAmount,"，当前价格为",Ticker.Buy); 
                        }else{
                            //如果价格可以接受，那就比较当前价与买入价+交易手续费*2哪个利盈高，就用哪个挂单
						    Log("当前价没有跌超买入价的5%，仅下跌",sellprofit,"，不急卖，以当前价与买入价+交易手续费*3中较高者挂单卖",opAmount,"，当挂单价格为",maxsellprice); 
                            //因为挂单价格较高，调整操作频率为1分钟,给一定的卖出时间
                            operateinterval = 60;
                        }
						orderid = exchange.Sell(maxsellprice,opAmount);
						operatingStatus = OPERATE_STATUS_SELL;
						isOperated = true;
					}else{
						Log("卖币操作完成，持仓已经清空，继续观察行情。" ); 
						//修改最后一次操作的类型
						lastOperateType = operatingStatus;
						//重置订单操作状态
						operatingStatus = OPERATE_STATUS_NONE;
					}
				}else{
					Log("当前均线下穿数为：",crossPeriod," < 离市观察期：",tmpExitPeriod,"，不做操作保持观察。"); 
				}
			}
		}
		//判断并输出操作结果
		if(isOperated){
			if (orderid) {
				lastOrderId = orderid;
				Log("订单发送成功，订单编号：",lastOrderId);
			}else{
				operatingStatus = OPERATE_STATUS_NONE;
				Log("订单发送失败，取消正在操作状态");
			}
		}
		//暂停指定时间
        Sleep(operateinterval*1000);
    }
}
