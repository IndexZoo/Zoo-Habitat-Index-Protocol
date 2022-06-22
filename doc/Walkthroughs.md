# Walkhroughs
## Trade Example
- This example is executed on Polygon mainnet 
- First after having SetProtocol contracts and modules deployed then wired together.
- Index created symbol is DAIMTC which represents DAI and MATIC.
- Issue 1 index - index components refer to the addresses of wrapped matic (WMATIC) and PoS DAI on polygon.
```
await basicIssuanceModule.issue(setToken.address, ether(1), deployer.address);  
```
  - Issued `10**18` (1 unit) of index required issuer to pay `2*10**15` (0.002 WMATIC) and `10**3` (0.001 DAI). 
  - This is shown in the following screenshot, notice that the index contract now is having 0.002 WMATIC and 0.001 DAI balance
![alt](./zoo-issue%231.png "after done issuing 1 index")
- Now let's make a trade 
 - Here we trade 0.0005 of wmatic for equivalent amount of dai.
 - 0.0001 Dai in the argument of this call represents the minimum amount of dai to receive in the trade (slippage).
```
await tradeModule.trade(
  setToken.address,
  "SUSHI",
  wmaticToken.address,
  ether(5).div(10000),   // 0.0005 
  daiToken.address,
  ether(1).div(10000),   //  0.0001
  "0x"
);
```
  - It is shown in the following screenshot that we have in our index and amount of 0.0015 WMATIC and an increase in the DAI. That is because 0.0005 WMATIC is swapped for DAI as instructed in previous step.
![](./zoo-trade%231.png "Trade operation")