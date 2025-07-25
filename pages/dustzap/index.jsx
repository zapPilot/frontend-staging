import React, {
  useState,
  useEffect,
  useMemo,
  useRef,
  useCallback,
} from "react";
import BasePage from "../basePage";
import WETH from "../../lib/contracts/Weth.json" assert { type: "json" };
import {
  Button,
  Card,
  Typography,
  Alert,
  Spin,
  Badge,
  Select,
  notification,
  Tooltip,
} from "antd";
import { InfoCircleOutlined } from "@ant-design/icons";
import {
  useActiveAccount,
  useActiveWalletChain,
  useSendBatchTransaction,
  useSendAndConfirmCalls,
  useSwitchActiveWalletChain,
} from "thirdweb/react";
import { getTokens } from "../../utils/dustConversion";
import { transformToDebankChainName } from "../../utils/chainHelper";
import { handleDustConversion } from "../../utils/dustConversion";
import ImageWithFallback from "../basicComponents/ImageWithFallback";
import Image from "next/image";
import logger from "../../utils/logger";
import {
  SparklesIcon,
  ArrowPathIcon,
  BoltIcon,
  CheckCircleIcon,
  ExclamationTriangleIcon,
} from "@heroicons/react/24/outline";
import { useWalletMode } from "../contextWrappers/WalletModeContext";
import { PriceService } from "../../classes/TokenPriceService";
import openNotificationWithIcon from "../../utils/notification";
import { LOCK_EXPLORER_URLS, TOKEN_ADDRESS_MAP } from "../../utils/general";
import { ethers } from "ethers";
import { prepareContractCall, getContract, toWei } from "thirdweb";
import THIRDWEB_CLIENT from "../../utils/thirdweb";
import { normalizeChainName } from "../../utils/chainHelper";
import axios from "axios";
import SocialShareModal from "../../components/modals/SocialShareModal";
import TokenImage from "../../components/shared/TokenImage";
import SlippageSelector from "../../components/dustzap/SlippageSelector";
import { formatSmallNumber } from "../../utils/formatters";
import {
  getFilteredAndSortedTokens,
  getTokenSymbol,
} from "../../utils/tokenUtils";

const { Title, Text, Paragraph } = Typography;
const { Option } = Select;

// =============== CONSTANTS ===============
const PROTOCOL_TREASURY_ADDRESS = "0x2eCBC6f229feD06044CDb0dD772437a30190CD50";
const BATCH_SIZE = 10;
const FEE_RATE = 0.0001; // 0.01% fee
const REFERRAL_FEE_PERCENTAGE = 0.7; // 70% of fee goes to referrer
const DEFAULT_SLIPPAGE = 49;

// =============== FEE CALCULATION UTILITIES ===============
const mulReferralFeeRate = (inputBigNumber) => {
  return inputBigNumber.mul(Math.floor(REFERRAL_FEE_PERCENTAGE * 10)).div(10);
};

const calculateReferralFee = (amount) => {
  return mulReferralFeeRate(amount);
};

const getReferrer = async (owner) => {
  try {
    const response = await fetch(
      `${
        process.env.NEXT_PUBLIC_SDK_API_URL
      }/referral/${owner.toLowerCase()}/referees`,
    );
    const data = await response.json();
    return data.referrer;
  } catch (error) {
    logger.warn("Failed to get referrer:", error);
    return null;
  }
};

const getPlatformFeeTxns = (chainMetadata, platformFee, referrer) => {
  const wrappedTokenAddress =
    TOKEN_ADDRESS_MAP.weth[normalizeChainName(chainMetadata.name)];
  const wethContract = getContract({
    client: THIRDWEB_CLIENT,
    address: wrappedTokenAddress,
    chain: chainMetadata,
    abi: WETH,
  });

  let txns = [];

  // First, wrap ETH to WETH (deposit)
  const wrapEthTxn = prepareContractCall({
    contract: wethContract,
    method: "deposit",
    value: toWei(ethers.utils.formatEther(platformFee)),
  });
  txns.push(wrapEthTxn);

  // Then transfer WETH as fees
  if (referrer) {
    const referralFee = calculateReferralFee(platformFee);
    const remainingPlatformFee = platformFee.sub(referralFee);

    // Transfer referral fee in WETH
    const referralFeeTxn = prepareContractCall({
      contract: wethContract,
      method: "transfer",
      params: [referrer, referralFee],
    });
    txns.push(referralFeeTxn);

    // Transfer remaining platform fee to treasury in WETH
    const treasuryFeeTxn = prepareContractCall({
      contract: wethContract,
      method: "transfer",
      params: [PROTOCOL_TREASURY_ADDRESS, remainingPlatformFee],
    });
    txns.push(treasuryFeeTxn);
  } else {
    // Transfer full platform fee to treasury in WETH
    const treasuryFeeTxn = prepareContractCall({
      contract: wethContract,
      method: "transfer",
      params: [PROTOCOL_TREASURY_ADDRESS, platformFee],
    });
    txns.push(treasuryFeeTxn);
  }

  return txns;
};

const calculateAndChargeEntryFees = async (
  totalValueUSD,
  chainMetadata,
  account,
  ethPrice,
) => {
  const feeUSD = totalValueUSD * FEE_RATE;
  const feeAmountInEth = feeUSD / ethPrice;

  if (feeAmountInEth < 1e-18) {
    return {
      platformFeeTxns: [],
      totalPlatformFeeUSD: 0,
      feeAmount: ethers.BigNumber.from(0),
    };
  }

  const feeAmount = ethers.utils.parseEther(feeAmountInEth.toFixed(18));
  const referrer = await getReferrer(account.address);
  const platformFeeTxns = getPlatformFeeTxns(
    chainMetadata,
    feeAmount,
    referrer,
  );

  return {
    platformFeeTxns,
    totalPlatformFeeUSD: feeUSD,
    feeAmount,
  };
};

// =============== UTILITY FUNCTIONS ===============

const calculateFeeInsertionBatch = (totalBatches) => {
  if (totalBatches <= 1) return 1;
  if (totalBatches === 2) return 2;
  if (totalBatches <= 4) return 2;
  return Math.max(2, Math.ceil(totalBatches * 0.33));
};

// =============== Components ===============
const HeroSection = ({
  totalValue,
  tokenCount,
  isConverting,
  onConvert,
  hasTokens,
  slippage,
  onSlippageChange,
}) => (
  <div className="relative overflow-hidden">
    {/* Background gradient */}
    <div className="absolute inset-0 bg-gradient-to-br from-blue-50 via-indigo-50 to-purple-50" />
    <div
      className="absolute inset-0 opacity-30"
      style={{
        backgroundImage: `url("data:image/svg+xml,%3Csvg width='60' height='60' viewBox='0 0 60 60' xmlns='http://www.w3.org/2000/svg'%3E%3Cg fill='none' fillRule='evenodd'%3E%3Cg fill='%23f1f5f9' fillOpacity='0.4'%3E%3Ccircle cx='7' cy='7' r='2'/%3E%3C/g%3E%3C/g%3E%3C/svg%3E")`,
      }}
    />

    <div className="relative px-8 py-16 text-center">
      <div className="mx-auto max-w-3xl">
        {/* Icon */}
        <div className="mb-8 flex justify-center">
          <div className="rounded-full bg-gradient-to-r from-blue-500 to-purple-600 p-4 shadow-lg">
            <SparklesIcon className="h-8 w-8 text-white" />
          </div>
        </div>

        {/* Title */}
        <Title
          level={1}
          className="mb-4 bg-gradient-to-r from-blue-600 to-purple-600 bg-clip-text text-transparent"
        >
          Convert Dust to ETH
        </Title>

        <Paragraph className="mb-8 text-lg text-gray-600 leading-relaxed">
          Transform your small token balances into valuable ETH with our free,
          gasless conversion service. Clean up your wallet and maximize your
          portfolio efficiency.
        </Paragraph>

        {/* Stats */}
        <div className="mb-12 grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
          <div className="rounded-xl bg-white/80 backdrop-blur-sm p-6 shadow-lg border border-white/50">
            <div className="text-3xl font-bold text-blue-600 mb-2">
              ${formatSmallNumber(totalValue)}
            </div>
            <div className="text-sm text-gray-600 font-medium">
              Total Dust Value
            </div>
          </div>

          <div className="rounded-xl bg-white/80 backdrop-blur-sm p-6 shadow-lg border border-white/50">
            <div className="text-3xl font-bold text-purple-600 mb-2">
              {tokenCount}
            </div>
            <div className="text-sm text-gray-600 font-medium">
              Tokens Found
            </div>
          </div>

          <div className="rounded-xl bg-white/80 backdrop-blur-sm p-6 shadow-lg border border-white/50 sm:col-span-2 lg:col-span-1">
            <div className="flex items-center justify-center text-emerald-600 mb-2">
              <BoltIcon className="h-8 w-8" />
            </div>
            <div className="text-sm text-gray-600 font-medium">
              <div>Gas-Free</div> (AA wallets; EOA soon)
            </div>
          </div>
        </div>

        {/* Action Button with Slippage Option */}
        <div className="space-y-3">
          <div className="flex justify-center">
            <SlippageSelector
              slippage={slippage}
              onChange={onSlippageChange}
              className=""
            />
          </div>

          <Button
            type="primary"
            size="large"
            loading={isConverting}
            disabled={!hasTokens || totalValue === 0}
            onClick={onConvert}
            className="h-14 px-12 text-lg font-semibold bg-gradient-to-r from-blue-600 to-purple-600 border-0 hover:from-blue-700 hover:to-purple-700 shadow-xl hover:shadow-2xl transition-all duration-300 transform hover:-translate-y-0.5"
            icon={<SparklesIcon className="h-5 w-5" />}
          >
            {isConverting ? "Converting..." : "Convert All Dust to ETH"}
          </Button>
        </div>

        {/* Service features */}
        <div className="mt-8 flex flex-wrap justify-center gap-6 text-sm text-gray-600">
          <div className="flex items-center gap-2">
            <CheckCircleIcon className="h-4 w-4 text-emerald-500" />
            <span>0.01% fee (${(totalValue * FEE_RATE).toFixed(4)})</span>
          </div>
          <div className="flex items-center gap-2">
            <CheckCircleIcon className="h-4 w-4 text-emerald-500" />
            <span>Gas-Free (AA wallets; EOA soon)</span>
          </div>
          <div className="flex items-center gap-2">
            <CheckCircleIcon className="h-4 w-4 text-emerald-500" />
            <span>Smart Fee Timing</span>
          </div>
        </div>
      </div>
    </div>
  </div>
);

const ProgressCard = ({
  messages,
  tokens,
  tokenPricesMappingTable,
  totalSteps,
  batchProgress,
  isConverting,
  fetchingSwapRoutes,
  aggregateTradingLoss,
}) => {
  if (!messages.length && !isConverting) return null;

  // Use aggregated trading loss instead of calculating from individual messages
  const totalLoss =
    aggregateTradingLoss ||
    messages.reduce((sum, msg) => sum + msg.tradingLoss, 0);
  const progress = Math.min(100, (messages.length / totalSteps) * 100);
  const batchProgressPercent =
    batchProgress.total > 0
      ? Math.min(100, (batchProgress.completed / batchProgress.total) * 100)
      : 0;

  const getTokenInfo = (symbol) => {
    return (
      tokens.find(
        (t) =>
          (t.optimized_symbol || t.symbol).toLowerCase() ===
          symbol.toLowerCase(),
      ) || { symbol }
    );
  };

  return (
    <Card
      className="shadow-lg border-0 bg-gradient-to-br from-blue-50 to-indigo-50"
      bodyStyle={{ padding: 0 }}
    >
      <div className="p-6">
        <div className="flex items-center gap-3 mb-6">
          <div className="rounded-full bg-blue-100 p-2">
            <ArrowPathIcon className="h-5 w-5 text-blue-600 animate-spin" />
          </div>
          <div>
            <Title level={4} className="mb-0 text-gray-800">
              {fetchingSwapRoutes
                ? "Preparing Conversion"
                : "Converting Tokens"}
            </Title>
            <Text className="text-gray-600">
              {fetchingSwapRoutes
                ? "Fetching swap routes for selected tokens..."
                : `${messages.length} of ${totalSteps} conversions completed`}
              {!fetchingSwapRoutes && batchProgress.total > 0 && (
                <span className="ml-2 text-blue-600">
                  • Batch {batchProgress.completed}/{batchProgress.total}
                </span>
              )}
            </Text>
          </div>
        </div>

        {/* Token Progress Bar */}
        <div className="mb-4">
          <div className="flex justify-between text-sm text-gray-600 mb-2">
            <span>Token Conversion Progress</span>
            <span>{Math.round(progress)}%</span>
          </div>
          <div className="w-full bg-gray-200 rounded-full h-3 overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-blue-500 to-purple-600 rounded-full transition-all duration-500 ease-out"
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>

        {/* Batch Progress Bar */}
        {batchProgress.total > 0 && (
          <div className="mb-6">
            <div className="flex justify-between text-sm text-gray-600 mb-2">
              <span>Batch Signing Progress</span>
              <span>{Math.round(batchProgressPercent)}%</span>
            </div>
            <div className="w-full bg-gray-200 rounded-full h-3 overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-green-500 to-emerald-600 rounded-full transition-all duration-500 ease-out"
                style={{ width: `${batchProgressPercent}%` }}
              />
            </div>
          </div>
        )}

        {/* Trading Loss Summary */}
        <div className="bg-white rounded-lg p-4 mb-6 border border-gray-100">
          <div className="flex justify-between items-center">
            <span className="text-gray-600 font-medium">
              Total Trading Loss:
            </span>
            <span className="text-lg font-bold text-red-500">
              ${formatSmallNumber(Math.abs(totalLoss))}
            </span>
          </div>
        </div>

        {/* Conversion Details */}
        <div className="space-y-3 max-h-80 overflow-y-auto">
          {messages.map((msg, index) => {
            const fromToken = getTokenInfo(msg.fromToken);
            const toToken = getTokenInfo(msg.toToken);
            const outputValue =
              msg.outputAmount *
              tokenPricesMappingTable[
                toToken.optimized_symbol || toToken.symbol
              ];

            return (
              <div
                key={index}
                className="bg-white rounded-lg p-4 border border-gray-100 shadow-sm"
              >
                <div className="flex items-center gap-3">
                  <div className="relative">
                    <Image
                      src={`/projectPictures/${msg.dexAggregator}.webp`}
                      alt={msg.dexAggregator}
                      height={32}
                      width={32}
                      className="rounded-full"
                    />
                    <Badge
                      count={index + 1}
                      size="small"
                      className="absolute -top-2 -right-2"
                      style={{ backgroundColor: "#1677ff" }}
                    />
                  </div>

                  <div className="flex-1">
                    <div className="flex items-center gap-2 text-sm font-medium text-gray-800">
                      <TokenImage token={fromToken} size={20} />
                      <span>{formatSmallNumber(msg.amount)}</span>
                      <span className="text-gray-400">→</span>
                      <span>{formatSmallNumber(msg.outputAmount)}</span>
                      <TokenImage token={toToken} size={20} />
                      <span className="text-green-600">
                        ${formatSmallNumber(outputValue)}
                      </span>
                    </div>
                    <div className="text-xs text-gray-500 mt-1">
                      Loss:{" "}
                      <span className="text-red-500">
                        ${formatSmallNumber(Math.abs(msg.tradingLoss))}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </Card>
  );
};

const TokenGrid = ({
  tokens,
  showDetails,
  onToggleDetails,
  onDeleteToken,
  deletedTokenIds,
  onRestoreDeletedTokens,
}) => {
  // Use the already filtered tokens from parent instead of filtering again
  const filteredAndSortedTokens = tokens;

  if (!filteredAndSortedTokens.length) return null;

  const displayTokens = showDetails
    ? filteredAndSortedTokens
    : filteredAndSortedTokens.slice(0, 6);

  return (
    <Card
      className="shadow-lg border-0"
      title={
        <div className="flex items-center justify-between">
          <span className="text-lg font-semibold text-gray-800">
            Token Details
          </span>
          <div className="flex gap-2">
            {deletedTokenIds.size > 0 && (
              <Button
                type="link"
                onClick={onRestoreDeletedTokens}
                className="p-0 h-auto text-green-600 hover:text-green-700"
              >
                Restore {deletedTokenIds.size} Deleted
              </Button>
            )}
            <Button
              type="link"
              onClick={onToggleDetails}
              className="p-0 h-auto text-blue-600 hover:text-blue-700"
            >
              {showDetails
                ? "Show Less"
                : `Show All ${filteredAndSortedTokens.length}`}
            </Button>
          </div>
        </div>
      }
    >
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {displayTokens.map((token) => {
          const totalValue = token.amount * token.price;
          const symbol = getTokenSymbol(token);
          return (
            <div
              key={token.id}
              className="relative bg-gradient-to-br from-gray-50 to-gray-100 rounded-lg p-4 hover:shadow-md transition-shadow duration-200"
            >
              <button
                onClick={() => onDeleteToken(token.id)}
                className="absolute top-2 right-2 bg-red-500 hover:bg-red-600 text-white rounded-full w-6 h-6 flex items-center justify-center text-xs font-bold transition-colors duration-200"
                title="Remove this token from conversion"
              >
                ×
              </button>
              <div className="flex items-center gap-3 mb-3">
                <TokenImage
                  token={token}
                  size={32}
                  className="w-8 h-8 shadow-sm"
                />
                <div className="flex-1 min-w-0">
                  <div className="font-semibold text-gray-900 truncate">
                    {symbol}
                  </div>
                  <div className="text-xs text-gray-500">
                    {formatSmallNumber(token.amount)} tokens
                  </div>
                </div>
              </div>

              <div className="space-y-1">
                <div className="flex justify-between">
                  <span className="text-sm text-gray-600">Value:</span>
                  <span className="text-sm font-semibold text-green-600">
                    ${formatSmallNumber(totalValue)}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-sm text-gray-600">Price:</span>
                  <span className="text-sm text-gray-800">
                    ${formatSmallNumber(token.price)}
                  </span>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {!showDetails && filteredAndSortedTokens.length > 6 && (
        <div className="mt-4 text-center">
          <Text className="text-gray-500">
            And {filteredAndSortedTokens.length - 6} more tokens...
          </Text>
        </div>
      )}
    </Card>
  );
};

// =============== MAIN COMPONENT ===============
export default function DustZap() {
  // =============== HOOKS ===============
  const account = useActiveAccount();
  const activeChain = useActiveWalletChain();
  const switchChain = useSwitchActiveWalletChain();
  const { aaOn } = useWalletMode();
  const { mutate: sendBatchTransaction } = useSendBatchTransaction();
  const { mutate: sendCalls } = useSendAndConfirmCalls();
  const [notificationAPI, notificationContextHolder] =
    notification.useNotification();

  // =============== STATE ===============
  const [tokens, setTokens] = useState([]);
  const [loading, setLoading] = useState(false);
  const [isConverting, setIsConverting] = useState(false);
  const [error, setError] = useState(null);
  const [showDetails, setShowDetails] = useState(false);
  const [statusMessages, setStatusMessages] = useState([]);
  const [totalSteps, setTotalSteps] = useState(0);
  const [slippage, setSlippage] = useState(DEFAULT_SLIPPAGE);
  const [showProgressCard, setShowProgressCard] = useState(false);
  const [ethPrice, setEthPrice] = useState(null);
  const [batchProgress, setBatchProgress] = useState({
    completed: 0,
    total: 0,
  });
  const [transactionSigned, setTransactionSigned] = useState(false);
  const [deletedTokenIds, setDeletedTokenIds] = useState(new Set());
  const [showSocialModal, setShowSocialModal] = useState(false);
  const [socialModalData, setSocialModalData] = useState(null);
  const [fetchingSwapRoutes, setFetchingSwapRoutes] = useState(false);
  const [aggregateTradingLoss, setAggregateTradingLoss] = useState(0);

  const statusMessagesRef = useRef([]);

  // =============== EFFECTS ===============
  useEffect(() => {
    statusMessagesRef.current = statusMessages;
  }, [statusMessages]);

  useEffect(() => {
    if (!account?.address || !activeChain?.name) return;

    const fetchTokens = async () => {
      setLoading(true);
      setError(null);
      try {
        const fetchedTokens = await getTokens(
          transformToDebankChainName(activeChain.name.toLowerCase()),
          account.address,
        );
        setTokens(fetchedTokens);
      } catch (err) {
        setError(err.message);
        setTokens([]);
      } finally {
        setLoading(false);
      }
    };

    fetchTokens();
  }, [account?.address, activeChain?.name]);

  // =============== COMPUTED VALUES ===============
  const filteredAndSortedTokens = useMemo(() => {
    const baseFiltered = getFilteredAndSortedTokens(tokens);
    return baseFiltered.filter((token) => !deletedTokenIds.has(token.id));
  }, [tokens, deletedTokenIds]);

  const totalValue = useMemo(
    () =>
      filteredAndSortedTokens.reduce(
        (sum, token) => sum + token.amount * token.price,
        0,
      ),
    [filteredAndSortedTokens],
  );

  // =============== HANDLERS ===============
  const handleStatusUpdate = (message) => {
    const currentMessages = statusMessagesRef.current;
    const updatedMessages = [...currentMessages, message];

    if (currentMessages.length === 0 && message.totalSteps) {
      setTotalSteps(message.totalSteps);
    }

    setStatusMessages(updatedMessages);
  };

  const handleDeleteToken = useCallback((tokenId) => {
    setDeletedTokenIds((prev) => new Set([...prev, tokenId]));
  }, []);

  const handleRestoreDeletedTokens = useCallback(() => {
    setDeletedTokenIds(new Set());
  }, []);

  // =============== TRANSACTION HELPERS ===============
  const insertFeeTransactionsStrategically = (dustTxns, feeTxns) => {
    const totalBatches = Math.ceil(dustTxns.length / BATCH_SIZE);

    if (totalBatches <= 1 || feeTxns.length === 0) {
      return [...dustTxns, ...feeTxns];
    }

    const feeInsertionBatch = calculateFeeInsertionBatch(totalBatches);
    const insertionIndex = (feeInsertionBatch - 1) * BATCH_SIZE;

    return [
      ...dustTxns.slice(0, insertionIndex),
      ...feeTxns,
      ...dustTxns.slice(insertionIndex),
    ];
  };

  const executeAllTxnsWithSendCalls = async (
    txns,
    sendCalls,
    transactionCallbacks,
  ) => {
    const flatTxns = txns.flat(Infinity);
    const totalBatches = Math.ceil(flatTxns.length / BATCH_SIZE);

    setBatchProgress({ completed: 0, total: totalBatches });

    for (let i = 0; i < flatTxns.length; i += BATCH_SIZE) {
      const batch = flatTxns.slice(i, i + BATCH_SIZE);
      const isLastBatch = i + BATCH_SIZE >= flatTxns.length;
      const batchIndex = Math.floor(i / BATCH_SIZE) + 1;

      await new Promise((resolve, reject) => {
        sendCalls(
          { calls: batch, atomicRequired: false },
          {
            onSuccess: async (data) => {
              await transactionCallbacks.onSuccess?.(
                data,
                isLastBatch,
                batchIndex,
              );
              resolve();
            },
            onError: async (err) => {
              await transactionCallbacks.onError?.(err, batchIndex);
              reject(err);
            },
          },
        );
      });
    }
  };

  const handleConvert = async () => {
    if (!account?.address || !activeChain) return;

    setIsConverting(true);
    setStatusMessages([]);
    setTransactionSigned(false);
    setTotalSteps(filteredAndSortedTokens.length);
    setShowProgressCard(true);
    setFetchingSwapRoutes(true);

    const priceService = new PriceService(process.env.NEXT_PUBLIC_API_URL);
    const fetchedEthPrice = await priceService.fetchPrice("eth", {
      coinmarketcapApiId: 2396,
    });
    setEthPrice(fetchedEthPrice);

    try {
      const { platformFeeTxns } = await calculateAndChargeEntryFees(
        totalValue,
        activeChain,
        account,
        fetchedEthPrice,
      );

      // NEW: Fetch swap routes only for selected tokens at conversion time
      const { fetchDustConversionRoutes } = await import(
        "../../utils/dustConversion"
      );
      const [dustConversionTxns, totalTradingLoss] =
        await fetchDustConversionRoutes({
          tokens: filteredAndSortedTokens, // Use filtered tokens (excluding deleted)
          chainId: activeChain?.id,
          accountAddress: account?.address,
          tokenPricesMappingTable: { eth: fetchedEthPrice },
          slippage: slippage,
          handleStatusUpdate,
        });

      setFetchingSwapRoutes(false);

      // Set the aggregate trading loss state
      setAggregateTradingLoss(totalTradingLoss);

      // Use strategic fee insertion instead of simple concatenation
      const allTxns = insertFeeTransactionsStrategically(
        dustConversionTxns,
        platformFeeTxns,
      );

      if (allTxns && allTxns.length > 0) {
        const transactionCallbacks = {
          onSuccess: async (data, isLastBatch = true, batchIndex = 1) => {
            // Extract transaction hash
            const txnHash =
              data?.transactionHash || data?.receipts?.[0]?.transactionHash;

            // Get explorer URL
            const explorerUrl =
              data?.chain?.blockExplorers !== undefined
                ? data.chain.blockExplorers[0].url
                : LOCK_EXPLORER_URLS[activeChain?.id];

            // Update batch progress
            setBatchProgress((prev) => ({ ...prev, completed: batchIndex }));

            // Determine if this batch contains fee transactions
            const totalDustBatches = Math.ceil(
              dustConversionTxns.length / BATCH_SIZE,
            );
            const feeInsertionBatch =
              calculateFeeInsertionBatch(totalDustBatches);
            const isFeeBatch =
              batchIndex === feeInsertionBatch && platformFeeTxns.length > 0;

            // Show notification for this batch
            const notificationTitle = isLastBatch
              ? "All Dust Conversions Complete!"
              : isFeeBatch
              ? `Platform Fee Charged - Batch ${batchIndex}`
              : `Dust Conversion - Batch ${batchIndex}`;

            const notificationDescription = `Batch ${batchIndex} processed successfully. View: ${explorerUrl}/tx/${txnHash}`;

            openNotificationWithIcon(
              notificationAPI,
              notificationTitle,
              "success",
              notificationDescription,
            );

            // Hide progress card once first transaction is signed
            if (batchIndex === 1) {
              setTransactionSigned(true);
            }

            // Show social sharing modal after final successful batch
            if (isLastBatch) {
              const ethAmount = fetchedEthPrice
                ? totalValue / fetchedEthPrice
                : 0;
              setSocialModalData({
                totalValue,
                tokenCount: filteredAndSortedTokens.length,
                transactionHash: txnHash,
                explorerUrl,
                ethAmount,
              });
              setShowSocialModal(true);
            }

            logger.log(`Batch ${batchIndex} completed with hash: ${txnHash}`);
          },

          onError: async (error, batchIndex = 1) => {
            logger.error(`Batch ${batchIndex} failed:`, error);

            openNotificationWithIcon(
              notificationAPI,
              `Batch ${batchIndex} Failed`,
              "error",
              error?.message || "Transaction failed",
            );

            throw error;
          },
        };
        // Execute transactions based on wallet mode
        if (!aaOn) {
          await executeAllTxnsWithSendCalls(
            allTxns,
            sendCalls,
            transactionCallbacks,
          );
        } else {
          await new Promise((resolve, reject) => {
            sendBatchTransaction(allTxns.flat(Infinity), {
              onSuccess: async (data) => {
                await transactionCallbacks.onSuccess(data, true, 1);
                resolve();
              },
              onError: async (error) => {
                await transactionCallbacks.onError(error, 1);
                reject(error);
              },
            });
          });
        }
        await axios.post(
          `${process.env.NEXT_PUBLIC_SDK_API_URL}/discord/webhook`,
          {
            errorMsg: `<@648492945938317334> ${account?.address}: Dust conversion success`,
          },
        );
      }
    } catch (err) {
      setError(err.message || "Conversion failed");
      logger.error("Dust conversion failed:", err);
    } finally {
      setIsConverting(false);
      setFetchingSwapRoutes(false);
    }
  };

  // =============== RENDER ===============
  if (!account) {
    return (
      <BasePage chainId={activeChain} switchChain={switchChain}>
        <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 flex items-center justify-center">
          <Card className="w-full max-w-md text-center shadow-xl border-0">
            <div className="p-8">
              <div className="mb-6">
                <ExclamationTriangleIcon className="h-16 w-16 text-amber-500 mx-auto" />
              </div>
              <Title level={3} className="mb-4 text-gray-800">
                Wallet Required
              </Title>
              <Paragraph className="text-gray-600 mb-6">
                Please connect your wallet to use the dust conversion service.
              </Paragraph>
            </div>
          </Card>
        </div>
      </BasePage>
    );
  }

  return (
    <BasePage chainId={activeChain} switchChain={switchChain}>
      {notificationContextHolder}
      <SocialShareModal
        visible={showSocialModal}
        onClose={() => setShowSocialModal(false)}
        conversionData={socialModalData}
      />
      <div className="min-h-screen bg-gradient-to-br from-slate-50 via-blue-50 to-indigo-100">
        <HeroSection
          totalValue={totalValue}
          tokenCount={filteredAndSortedTokens.length}
          isConverting={isConverting}
          onConvert={handleConvert}
          hasTokens={filteredAndSortedTokens.length > 0}
          slippage={slippage}
          onSlippageChange={setSlippage}
        />

        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pb-16">
          {/* Loading State */}
          {loading && (
            <div className="text-center py-16">
              <Spin size="large" />
              <div className="mt-4 text-lg text-gray-600">
                Loading your tokens...
              </div>
            </div>
          )}

          {/* Error State */}
          {error && !loading && (
            <Alert
              message="Error Loading Tokens"
              description={error}
              type="error"
              showIcon
              className="mb-8"
            />
          )}

          {/* No Tokens State */}
          {!loading && !error && filteredAndSortedTokens.length === 0 && (
            <Card className="text-center shadow-lg border-0 bg-gradient-to-br from-green-50 to-emerald-50">
              <div className="py-16">
                <CheckCircleIcon className="h-16 w-16 text-emerald-500 mx-auto mb-6" />
                <Title level={3} className="mb-4 text-gray-800">
                  All Clean!
                </Title>
                <Paragraph className="text-gray-600 text-lg">
                  No dust tokens found in your wallet. Your portfolio is already
                  optimized!
                </Paragraph>
              </div>
            </Card>
          )}

          {/* Conversion Progress */}
          {showProgressCard &&
            !transactionSigned &&
            (statusMessages.length > 0 || isConverting) && (
              <div className="mb-8">
                <ProgressCard
                  messages={statusMessages}
                  tokens={tokens}
                  tokenPricesMappingTable={{ eth: ethPrice }}
                  totalSteps={totalSteps}
                  batchProgress={batchProgress}
                  isConverting={isConverting}
                  fetchingSwapRoutes={fetchingSwapRoutes}
                  aggregateTradingLoss={aggregateTradingLoss}
                />
              </div>
            )}

          {/* Token Grid */}
          {!loading && filteredAndSortedTokens.length > 0 && (
            <TokenGrid
              tokens={filteredAndSortedTokens}
              showDetails={showDetails}
              onToggleDetails={() => setShowDetails(!showDetails)}
              onDeleteToken={handleDeleteToken}
              deletedTokenIds={deletedTokenIds}
              onRestoreDeletedTokens={handleRestoreDeletedTokens}
            />
          )}
        </div>
      </div>
    </BasePage>
  );
}
