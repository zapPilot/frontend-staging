import React, { useEffect, memo, useState, useMemo, useCallback } from "react";
import { Button, Space } from "antd";
import {
  useWalletBalance,
  useActiveWalletChain,
  useActiveAccount,
} from "thirdweb/react";
import THIRDWEB_CLIENT from "../../utils/thirdweb";
import { arbitrum, base, optimism, bsc, polygon } from "thirdweb/chains";
import { defineChain } from "thirdweb";
import NumericInput from "./NumberInput";
import { selectBefore } from "../../utils/contractInteractions";

const chainIdToChain = {
  8453: base,
  42161: arbitrum,
  10: optimism,
  56: bsc,
  137: polygon,
  1088: defineChain(1088),
};

const TokenDropdownInput = memo(
  ({
    selectedToken,
    setSelectedToken,
    setInvestmentAmount,
    tokenPricesMappingTable,
    mode,
  }) => {
    const [localInvestmentAmount, setLocalInvestmentAmount] = useState("");
    const tokenAddress = selectedToken?.split("-")[1];
    const tokenSymbol = selectedToken?.split("-")[0]?.toLowerCase();
    const account = useActiveAccount();
    const chainId = useActiveWalletChain();
    const { data, isLoading } = useWalletBalance({
      chain: chainIdToChain[chainId?.id],
      address: account?.address,
      client: THIRDWEB_CLIENT,
      ...(tokenAddress !== "0x0000000000000000000000000000000000000000" && {
        tokenAddress,
      }),
    });

    const tokenPrice = useMemo(() => {
      return tokenPricesMappingTable?.[tokenSymbol] || 0;
    }, [tokenPricesMappingTable, tokenSymbol]);

    const getUsdValue = useCallback(
      (amount) => {
        return (amount * tokenPrice).toLocaleString("en-US", {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        });
      },
      [tokenPrice],
    );

    const isInsufficientBalance = useMemo(() => {
      return localInvestmentAmount > parseFloat(data?.displayValue || "0");
    }, [localInvestmentAmount, data?.displayValue]);

    const handleInputChange = (eventValue) => {
      setLocalInvestmentAmount(parseFloat(eventValue) || 0);
      setInvestmentAmount(eventValue);
    };

    const handleOnClickMax = () => {
      if (data?.displayValue) {
        setLocalInvestmentAmount(data.displayValue);
        setInvestmentAmount(data.displayValue);
      }
    };

    const handleTokenChange = (value) => {
      setSelectedToken(value);
      setLocalInvestmentAmount(""); // Reset the input when token changes
      setInvestmentAmount(0); // Also reset the parent state
    };

    useEffect(() => {
      // Reset the input when selectedToken changes
      setLocalInvestmentAmount("");
      setInvestmentAmount(0);
    }, [selectedToken, setInvestmentAmount]);

    // Render balance information
    const renderBalanceInfo = () => {
      return (
        <div className="mt-2 text-sm">
          Balance:{" "}
          <span
            className={isInsufficientBalance ? "text-red-400" : "text-gray-400"}
          >
            {isLoading ? "Loading..." : data?.displayValue || "0"}
            {tokenPricesMappingTable &&
              tokenPricesMappingTable[tokenSymbol] && (
                <span className="text-gray-400">
                  {" "}
                  (≈ ${getUsdValue(localInvestmentAmount)} USD)
                </span>
              )}
          </span>
          {isInsufficientBalance && (
            <p className="text-red-400">
              Please send more {tokenSymbol?.toUpperCase()} to your AA Wallet to
              continue.
              <br />
              Click on the top-right corner to get your AA Wallet address.
            </p>
          )}
        </div>
      );
    };

    if (mode === "claim") {
      return (
        <>{selectBefore(handleTokenChange, chainId?.id, selectedToken)} </>
      );
    }

    return (
      <>
        <Space.Compact role="crypto_input">
          {selectBefore(handleTokenChange, chainId?.id, selectedToken)}
          <NumericInput
            placeholder={isLoading ? "Loading..." : "Enter amount"}
            value={localInvestmentAmount}
            onChange={handleInputChange}
          />
          <Button
            type="primary"
            onClick={handleOnClickMax}
            disabled={isLoading || !data?.displayValue}
          >
            Max
          </Button>
        </Space.Compact>
        {renderBalanceInfo()}
      </>
    );
  },
);

TokenDropdownInput.displayName = "TokenDropdownInput";

export default TokenDropdownInput;
