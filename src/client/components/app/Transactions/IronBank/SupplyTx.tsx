import { FC, useState, useEffect } from 'react';

import { useAppSelector, useAppDispatch, useAppDispatchAndUnwrap, useDebounce } from '@hooks';
import { IronBankSelectors, TokensActions, IronBankActions, TokensSelectors } from '@store';
import {
  toBN,
  normalizeAmount,
  normalizePercent,
  USDC_DECIMALS,
  validateAllowance,
  basicValidateAmount,
  COLLATERAL_FACTOR_DECIMALS,
} from '@src/utils';

import { IronBankTransaction } from '../IronBankTransaction';

export interface IronBankSupplyTxProps {
  onClose?: () => void;
}

export const IronBankSupplyTx: FC<IronBankSupplyTxProps> = ({ onClose }) => {
  const dispatch = useAppDispatch();
  const dispatchAndUnwrap = useAppDispatchAndUnwrap();
  const [amount, setAmount] = useState('');
  const [debouncedAmount] = useDebounce(amount, 500);
  const [txCompleted, setTxCompleted] = useState(false);
  const markets = useAppSelector(IronBankSelectors.selectMarkets);
  const selectedMarket = useAppSelector(IronBankSelectors.selectSelectedMarket);
  const selectedToken = selectedMarket?.token;
  const selectedTokenAddress = useAppSelector(TokensSelectors.selectSelectedTokenAddress);
  const userIronBankSummary = useAppSelector(IronBankSelectors.selectSummaryData);
  const actionsStatus = useAppSelector(IronBankSelectors.selectSelectedMarketActionsStatusMap);

  const onExit = () => {
    dispatch(IronBankActions.clearSelectedMarketAndStatus());
  };

  useEffect(() => {
    if (!selectedMarket && selectedTokenAddress) {
      if (!markets || !markets.length) return;

      const matchingMarket = markets.find((market) => market.token.address === selectedTokenAddress);
      if (!matchingMarket) return;
      dispatch(
        IronBankActions.setSelectedMarketAddress({
          marketAddress: matchingMarket.address,
        })
      );
    }
    return () => {
      onExit();
    };
  }, []);

  useEffect(() => {
    if (!selectedMarket) return;

    dispatch(
      TokensActions.getTokenAllowance({
        tokenAddress: selectedMarket.token.address,
        spenderAddress: selectedMarket.address,
      })
    );
  }, [selectedMarket?.address]);

  useEffect(() => {
    if (!selectedMarket || !generalError) return;
    dispatch(IronBankActions.clearMarketStatus({ marketAddress: selectedMarket.address }));
  }, [debouncedAmount]);

  if (!selectedMarket || !userIronBankSummary || !selectedToken) {
    return null;
  }

  const borrowBalance = normalizeAmount(userIronBankSummary.borrowBalanceUsdc, USDC_DECIMALS);
  const underlyingTokenPrice = normalizeAmount(selectedToken.priceUsdc, USDC_DECIMALS);
  const amountValue = toBN(amount).times(underlyingTokenPrice).toString();
  const collateralFactor = normalizeAmount(selectedMarket.collateralFactor, COLLATERAL_FACTOR_DECIMALS);
  const collateralAmount = toBN(amountValue).times(collateralFactor).toString();
  const borrowLimit = normalizeAmount(userIronBankSummary.borrowLimitUsdc, USDC_DECIMALS);

  const projectedBorrowLimit = toBN(borrowLimit).plus(collateralAmount).toString();
  const asset = { ...selectedToken, yield: normalizePercent(selectedMarket.lendApy, 2) };

  const { approved: isApproved, error: allowanceError } = validateAllowance({
    tokenAmount: toBN(amount),
    tokenAddress: selectedToken.address,
    tokenDecimals: selectedToken.decimals.toString(),
    tokenAllowancesMap: selectedToken.allowancesMap,
    spenderAddress: selectedMarket.address,
  });

  const { approved: isValidAmount, error: inputError } = basicValidateAmount({
    sellTokenAmount: toBN(amount),
    sellTokenDecimals: selectedToken.decimals.toString(),
    totalAmountAvailable: selectedToken.balance,
  });

  const sourceError = allowanceError || inputError;
  const targetError = actionsStatus.approve.error || actionsStatus.supply.error;
  const generalError = sourceError || targetError;

  const onTransactionCompletedDismissed = () => {
    if (onClose) onClose();
  };

  const approve = async () => {
    await dispatch(
      IronBankActions.approveMarket({
        marketAddress: selectedMarket.address,
        tokenAddress: selectedToken.address,
      })
    );
  };

  const supply = async () => {
    try {
      await dispatchAndUnwrap(
        IronBankActions.supplyMarket({
          marketAddress: selectedMarket.address,
          amount: toBN(amount),
        })
      );
      setTxCompleted(true);
    } catch (error) {}
  };

  const txActions = [
    {
      label: 'Approve',
      onAction: approve,
      status: actionsStatus.approve,
      disabled: isApproved,
    },
    {
      label: 'Supply',
      onAction: supply,
      status: actionsStatus.supply,
      disabled: !isApproved || !isValidAmount,
      contrast: true,
    },
  ];

  return (
    <IronBankTransaction
      transactionLabel="Supply"
      transactionCompleted={txCompleted}
      transactionCompletedLabel="Exit"
      onTransactionCompletedDismissed={onTransactionCompletedDismissed}
      assetHeader="To Iron Bank"
      assetLabel="Wallet Balance"
      asset={asset}
      amount={amount}
      amountValue={amountValue}
      onAmountChange={setAmount}
      borrowBalance={borrowBalance}
      borrowLimit={borrowLimit}
      projectedBorrowLimit={projectedBorrowLimit}
      yieldType={'SUPPLY'}
      actions={txActions}
      sourceStatus={{ error: sourceError }}
      targetStatus={{ error: targetError }}
      onClose={onClose}
    />
  );
};