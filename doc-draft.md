# Documentation
## SetTokenCreator
SetTokenCreator is a smart contract used to deploy new SetToken contracts. The SetTokenCreator is a Factory contract that is enabled by the controller to create and register new SetTokens.
### **create**
```
function create( address[] memory _components, int256[] memory _units, address[] memory _modules, address _manager, string memory _name, string memory _symbol ) external onlyOwner returns (address)
```
Creates a SetToken smart contract and registers the SetToken with the controller. The SetTokens are composed of positions that are instantiated as DEFAULT (positionState = 0) state. Administrative function only called by *owner*.
     
- **_components**             List of addresses of components for initial Positions
- **_units**                  List of units. Each unit is the # of components per 10^18 of a SetToken
- **_modules**                List of modules to enable. All modules must be approved by the Controller
- **_manager**                Address of the manager
- **_name**                   Name of the SetToken
- **_symbol**                 Symbol of the SetToken
- **address**                Address of the newly created SetToken
## IntegrationRegistry
The IntegrationRegistry holds state relating to the Modules and the integrations they are connected with. The state is combined into a single Registry to allow governance updates to be aggregated to one contract.
### **addIntegration**
```
function addIntegration( address _module, string memory _name, address _adapter) public
```
Add a new Integration to registry, *integration* is an entity which represents external components e.g. uniswap. Administrative function only called by *owner*. 
- **_module**       The address of the module associated with the integration i.e. TradeModule, SingleIndexModule
- **_name**         Human readable string identifying the integration
- **_adapter**      Address of the adapter contract to add
### **batchAddIntegration**
```
function batchAddIntegration(address[] memory _modules, string[] memory _names, address[] memory _adapters) external
```
Like previous function call *batchAddIntegration* adds integrations in mass to the registry. Administrative function only called by *owner*.
- **_modules**      Array of addresses of the modules associated with integration
- **_names**        Array of human readable strings identifying the integration
- **_adapters**     Array of addresses of the adapter contracts to add
### **editIntegration**
```
function editIntegration(address _module, string memory _name, address _adapter) public
```
Modify an already added integration
- **_module**       The address of the module associated with the integration
- **_name**         Human readable string identifying the integration
- **_adapter**      Address of the adapter contract to edit
### **removeIntegration**
```
function removeIntegration(address _module, string memory _name) external
```
Remove an existing integration on the registry. Administrative function only called by *owner*.
- **_module**       The address of the module associated with the integration
- **_name**         Human readable string identifying the integration
### **getIntegrationAdapter**
```
function getIntegrationAdapter(address _module, string memory _name) external view returns (address)
```
Get integration adapter address which have been already added on the registry associated with passed human readable name.
- **_module**       The address of the module associated with the integration
- **_name**         Human readable adapter name
- *return*               Address of adapter
### **isValidIntegration**
```
function isValidIntegration(address _module, string memory _name) external view returns (bool)
```
Check if adapter is valid i.e. added on the registry
- **_module**       The address of the module associated with the integration
- **_name**         Human readable string identifying the integration
- *return*               Boolean indicating if valid
## BasicIssuanceModule
Module that enables issuance and redemption functionality on a SetToken. This is a module that is required to bring the totalSupply of a Set above 0.
### **issue**
Deposits the SetToken's position components into the SetToken and mints the SetToken of the given quantity to the specified _to address.  
```
function issue( ISetToken _setToken, uint256 _quantity, address _to) external 
```
- **_setToken**             Instance of the SetToken contract
- **_quantity**             Quantity of the SetToken to mint
- **_to**                   Address to mint SetToken to
### **redeem**
Redeems the SetToken's positions and sends the components of the given quantity to the caller.
```
function redeem(ISetToken _setToken, uint256 _quantity, address _to) external
```
- **_setToken**             Instance of the SetToken contract
- **_quantity**             Quantity of the SetToken to redeem
- **_to**                   Address to send component assets to
### **initialize**
Initializes this module to the SetToken with issuance-related hooks. Hooks are like callbacks that are called after issuance. Only callable by the SetToken's manager. Hook addresses are optional. Address(0) means that no hook will be called. This function is a must call after SetToken creation in order to enable the module to operate on it.
```
function initialize(ISetToken _setToken, IManagerIssuanceHook _preIssueHook) external
```
- **_setToken**             Instance of the SetToken to issue
- **_preIssueHook**         Instance of the Manager Contract with the Pre-Issuance Hook function
### **getRequiredComponentUnitsForIssue**
Retrieves the addresses and units required to mint a particular quantity of SetToken.
```
function getRequiredComponentUnitsForIssue( ISetToken _setToken, uint256 _quantity ) public view returns (address[] memory, uint256[] memory)
```
- **_setToken**             Instance of the SetToken to issue
- **_quantity**             Quantity of SetToken to issue
- *return* address[]            List of component addresses
- *return* uint256[]            List of component units required to issue the quantity of SetTokens
## TradeModule
Module that enables SetTokens to perform atomic trades using uniswap-like (e.g. Uniswap, Sushiswap, Pancakeswap, ...etc) Decentralized Exchanges. Integrations mappings are stored on the IntegrationRegistry contract.
### **initialize**
Initializes this module to the SetToken. Only callable by the SetToken's manager.
```
function initialize(ISetToken _setToken) external
```
- **_setToken**                 Instance of the SetToken to initialize
### **trade**
Executes a trade on a supported DEX. Only callable by the SetToken's manager. **Note that** although the SetToken units are passed in for the send and receive quantities, the total quantity sent and received is the quantity of SetToken units multiplied by the SetToken totalSupply.
```
function trade(ISetToken _setToken, string memory _exchangeName, address _sendToken, uint256 _sendQuantity, address _receiveToken, uint256 _minReceiveQuantity, bytes memory _data ) external
```
- **_setToken**             Instance of the SetToken to trade
- **_exchangeName**         Human readable name of the exchange that has been registered the registry
- **_sendToken**            Address of the token to be sent to the exchange
- **_sendQuantity**         Units of token in SetToken sent to the exchange
- **_receiveToken**         Address of the token that will be received from the exchange
- **_minReceiveQuantity**   Min units of token in SetToken to be received from the exchange
- **_data**                 Arbitrary bytes to be used to construct trade call data
## SingleIndexModule
Module that facilitates rebalances for indices. Manager can set target unit amounts, max trade sizes, the exchange to trade on, and the cool down period between trades (on a per asset basis) for the sake of rebalancing the assets. As currently constructed the module only works for one Set at a time.
### **initialize**
Initializes this module to the SetToken. Only callable by the SetToken's manager.
```
function initialize(ISetToken _index) external
```
- **_index**            Address of index being used for this Set
### **startRebalance**
Set new target units, zeroing out any units for components being removed from index. Log position multiplier to adjust target units in case fees are accrued. Validate that weth is not a part of the new allocation and that all components in current allocation are in `_components` array. Considered administrative function, hence to be called my Manager only
```
function startRebalance(address[] calldata _newComponents, uint256[] calldata _newComponentsTargetUnits, uint256[] calldata _oldComponentsTargetUnits, uint256 _positionMultiplier) external
```
- **_newComponents**                    Array of new components to add to allocation
- **_newComponentsTargetUnits**         Array of target units at end of rebalance for new components, maps to same index of component
- **_oldComponentsTargetUnits**         Array of target units at end of rebalance for old component, maps to same index of component,
     *                                               if component being removed set to 0.
- **_positionMultiplier**               Position multiplier when target units were calculated, needed in order to adjust target units
     *                                               if fees accrued
### **trade** 
Only approved addresses can call if `anyoneTrade` is false. Determines trade size and direction and swaps into or out of WETH on exchange specified by manager.
```
function trade(address _component) external
```
- **_component**            Component to trade
### **tradeRemainingWETH**
Only approved addresses can call if anyoneTrade is false. Only callable when 
1) There are no more components to be sold (i.e. being on the buying phase of the rebalance).
2) Entire remaining WETH amount can be traded such that resulting inflows won't exceed components maxTradeSize nor overshoot the target unit. 
To be used near the end of rebalances when a component's calculated trade size is greater in value than remaining WETH.
```
function tradeRemainingWETH(address _component) external
```
- **_component**            Component to trade
### **raiseAssetTargets**
Only allowed trader can call this function. For situation where all target units met and SetToken still holds some remaining WETH, uniformly raise targets by same percentage in order to allow further trading. Can be called multiple times if necessary, increase should be small in order to reduce tracking error.
```
function raiseAssetTargets() external
```
### **setTradeMaximums**
Set trade maximums for passed components. Only called by Manager.
```
function setTradeMaximums( address[] calldata _components, uint256[] calldata _tradeMaximums) external
```
- **_components**            Array of components
- **_tradeMaximums**         Array of trade maximums mapping to correct component
### **setExchanges**
Set a uniswap-like decentralized exchanges for passed components. Only called by Manager.
```
function setExchanges(address[] calldata _components, uint256[] calldata _exchanges) external
```
- **_components**        Array of components
- **_exchanges**         Array of exchanges mapping to correct component, uint256 used to signify exchange
### **setCoolOffPeriods** 
Set the coolOfffPeriod for components. It is needed in order to make sure enough time has elapsed since component's last trade. Only callable by Manager.
```
function setCoolOffPeriods(address[] calldata _components, uint256[] calldata _coolOffPeriods) external
```
- **_components**           Array of components
- **_coolOffPeriods**       Array of cool off periods to correct component
### **updatetraderstatus**
Toggle ability for passed addresses to trade from current state. Only called by Manager.
```
function updatetraderstatus(address[] calldata _traders, bool[] calldata _statuses) external
```
- **_traders**           Array trader addresses to toggle status
- **_statuses**          Booleans indicating if matching trader can trade
### **updateAnyoneTrade**
Toggle whether anyone can trade, bypassing the traderAllowList. Only called by Manager.
```
function updateAnyoneTrade(bool _status) external
```
- **_status**           Boolean indicating if anyone can trade
### **getTargetUnits**
Get target units for passed components, normalized to current positionMultiplier.
```
function getTargetUnits(address[] calldata _components) external view returns(uint256[] memory)
```
- **_components**           Array of components to get target units for
- *return*                      Array of targetUnits mapping to passed components
### **getRebalanceComponents**
Get the target components aimed to be rebalanced (i.e. result of a prior call of `startRebalance`)
```
function getRebalanceComponents() external view returns(address[] memory)
```
## StreamingFeeModule 
### **accrueFee**
Calculates total inflation percentage then mints new Sets to the fee recipient. Position units are then adjusted down (in magnitude) in order to ensure full collateralization. Callable by anyone.
```
function accrueFee(ISetToken _setToken) public
```
- **_setToken**       Address of SetToken
### **initialize** 
Initialize module with SetToken and set the fee state for the SetToken. Passed
`_settings` will have `lastStreamingFeeTimestamp` over-written.
```
function initialize (ISetToken _setToken, FeeState memory _settings) external
```
- **_setToken**                 Address of SetToken
- **_settings**                 FeeState struct defining fee parameters
### **removeModule**
Removes this module from the SetToken, via call by the SetToken. Manager's feeState is deleted. Fees are not accrued in case reason for removing module is related to fee accrual. Only callable by the SetToken's manager.
```
function removeModule() external
```
### **updateStreamingFee**
Set new streaming fee. Fees accrue at current rate then new rate is set. Fees are accrued to prevent the manager from unfairly accruing a larger percentage. Only callable by the SetToken's manager.
```
function updateStreamingFee(ISetToken _setToken, uint256 _newFee) external
```
- **_setToken**       Address of SetToken
- **_newFee**         New streaming fee 18 decimal precision
### **updateFeeRecipient**
Set new fee recipient.
```
function updateFeeRecipient(ISetToken _setToken, address _newFeeRecipient) external
```
- **_setToken**             Address of SetToken
- **_newFeeRecipient**      New fee recipient
### **getFee**
Calculates total inflation percentage in order to accrue fees to manager.
```
function getFee(ISetToken _setToken) external view returns (uint256)
```
- **_setToken**       Address of SetToken
- *return*  uint256       Percent inflation of supply