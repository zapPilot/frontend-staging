import React, { memo, useMemo, useCallback } from "react";
import { useEffect } from "react";
import Image from "next/image";
import styles from "../../styles/Home.module.css";
import { useDispatch, useSelector } from "react-redux";
import { useActiveAccount } from "thirdweb/react";
import { getPortfolioHelper } from "../../utils/thirdwebSmartWallet.ts";
import Link from "next/link";
import {
  fetchDataStart,
  fetchDataSuccess,
  fetchDataFailure,
} from "../../lib/features/apiSlice";
import { fetchStrategyMetadata } from "../../lib/features/strategyMetadataSlice.js";
import { walletAddressChanged } from "../../lib/features/subscriptionSlice";
import axios from "axios";
import { Spin } from "antd";
import { useRouter } from "next/router";
import Vaults from "../indexes/index.jsx";
import content from "../../config/content";

const API_URL = process.env.NEXT_PUBLIC_API_URL;

// Extracted vault configurations
const VAULTS_CONFIG = [
  {
    id: 1,
    portfolioName: "Stable+ Vault",
    imageSrc: "usdc",
    imageAlt: "Stable+ Vault",
  },
  {
    id: 2,
    portfolioName: "Index 500+ Vault",
    imageSrc: "index500vault",
    imageAlt: "Index 500 Vault",
  },
  {
    id: 3,
    portfolioName: "Index 500 Vault",
    imageSrc: "index500vault",
    imageAlt: "Index 500 Vault",
  },
  {
    id: 4,
    portfolioName: "ETH Vault",
    imageSrc: "eth",
    imageAlt: "ETH Vault",
  },
];

const PARTNERSHIP_VAULTS_CONFIG = [
  {
    id: 3,
    portfolioName: "Metis Vault",
    imageSrc: "metis",
    imageAlt: "Metis Vault",
  },
  {
    id: 4,
    portfolioName: "Deprecated Vault",
    imageSrc: "eth",
    imageAlt: "Deprecated Vault",
  },
];

const ExampleUI = memo(function ExampleUI() {
  const dispatch = useDispatch();
  const account = useActiveAccount();
  const router = useRouter();
  const { query } = router;
  const searchWalletAddress = query.address;
  const walletAddress = account?.address?.toLowerCase();

  const { strategyMetadata, strategyLoading, error } = useSelector(
    (state) => state.strategyMetadata,
  );

  // Memoize vaults data
  const vaults = useMemo(
    () =>
      VAULTS_CONFIG.map((vault) => ({
        ...vault,
        href: `/indexes/indexOverviews/?portfolioName=${encodeURIComponent(
          vault.portfolioName,
        )}`,
        apr: strategyMetadata?.[vault.portfolioName]?.portfolioAPR * 100,
        tvl:
          strategyMetadata?.[vault.portfolioName]?.portfolioTVL === undefined
            ? 0
            : strategyMetadata?.[vault.portfolioName]?.portfolioTVL,
        portfolioHelper: getPortfolioHelper(vault.portfolioName),
      })),
    [strategyMetadata],
  );

  const partnershipVaults = useMemo(
    () =>
      PARTNERSHIP_VAULTS_CONFIG.map((vault) => ({
        ...vault,
        href: `/indexes/indexOverviews/?portfolioName=${encodeURIComponent(
          vault.portfolioName,
        )}`,
        apr: strategyMetadata?.[vault.portfolioName]?.portfolioAPR * 100,
        tvl: strategyMetadata?.[vault.portfolioName]?.portfolioTVL,
        portfolioHelper: getPortfolioHelper(vault.portfolioName),
      })),
    [strategyMetadata],
  );

  // Memoize fetch function
  const fetchBundlePortfolio = useCallback(
    (refresh) => {
      if (!walletAddress && !searchWalletAddress) return;

      dispatch(fetchDataStart());
      const address = searchWalletAddress
        ? searchWalletAddress.toLowerCase().trim().replace("/", "")
        : walletAddress;

      axios
        .get(`${API_URL}/bundle_portfolio/${address}?refresh=${refresh}`)
        .then((response) => response.data)
        .then((data) => dispatch(fetchDataSuccess(data)))
        .catch((error) => dispatch(fetchDataFailure(error.toString())));
    },
    [dispatch, walletAddress, searchWalletAddress],
  );

  // Effects
  useEffect(() => {
    if (!strategyMetadata || Object.keys(strategyMetadata).length === 0) {
      dispatch(fetchStrategyMetadata());
    }
  }, [dispatch, strategyMetadata]);

  useEffect(() => {
    if (!walletAddress) return;
    dispatch(walletAddressChanged({ walletAddress }));
  }, [dispatch, walletAddress]);

  useEffect(() => {
    if (!walletAddress && !searchWalletAddress) return;
    fetchBundlePortfolio(false);
  }, [fetchBundlePortfolio, searchWalletAddress, walletAddress]);

  // Memoize APR display
  const aprDisplay = useMemo(() => {
    if (
      strategyLoading ||
      isNaN(strategyMetadata["Stable+ Vault"]?.portfolioAPR)
    ) {
      return <Spin />;
    }
    return (strategyMetadata["Stable+ Vault"]?.portfolioAPR * 100).toFixed(2);
  }, [strategyLoading, strategyMetadata]);

  return (
    <div className="px-2 text-white bg-black">
      <div className={`w-full md:w-5/6 md:ml-[8.333333%] ${styles.bgStyle}`}>
        <div className="flex items-center justify-center min-h-[calc(100vh-100px)]">
          <center>
            <h1 className="text-5xl tracking-tight mb-4 text-[#5DFDCB] font-extrabold">
              Zap Pilot
            </h1>
            <p
              className="text-xl text-[#B2FFF6] mb-2 font-medium mx-auto px-4 sm:px-8"
              style={{ maxWidth: "800px", lineHeight: "1.5" }}
            >
              {content.siteInfo.subtitle}
            </p>
            <p className="text-2xl text-gray-200 mb-2">
              {content.siteInfo.tagline}
            </p>
            <p className="text-3xl text-gray-100 font-semibold">
              Enjoy Up to
              <span
                className="text-5xl text-[#5DFDCB] font-bold px-2"
                data-testid="apr"
              >
                {aprDisplay}%
              </span>
              APR
            </p>
            <Link
              href={`/indexes/indexOverviews?portfolioName=${encodeURIComponent(
                "Stable+ Vault",
              )}`}
            >
              <button
                type="button"
                className="mt-8 px-4 py-2 w-52 h-12 font-semibold bg-transparent text-[#5DFDCB] rounded-md border border-solid border-[#5DFDCB] hover:bg-[#5DFDCB] hover:text-black transition-colors duration-200"
                role="invest_now"
              >
                Invest Now!
              </button>
            </Link>
          </center>
        </div>
      </div>

      <div className="w-full md:w-[75%] md:ml-[12.5%] flex justify-center items-center py-8">
        <div className="w-full md:w-2/3 lg:w-1/2">
          <div className="relative w-full aspect-video">
            <iframe
              className="absolute top-0 left-0 w-full h-full rounded-lg"
              src="https://www.youtube.com/embed/wSzdKyqLKdY?si=8nRvJgJ3wYuvS9ew"
              title="YouTube video player"
              frameBorder="0"
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
              referrerPolicy="strict-origin-when-cross-origin"
              loading="lazy"
              allowFullScreen
            />
          </div>
        </div>
      </div>

      <div className="w-full md:w-[75%] md:ml-[12.5%]">
        <h3 className="text-2xl text-emerald-400 font-semibold md:mb-4 px-4">
          Vaults
        </h3>
        <Vaults vaults={vaults} />
      </div>

      <div className="w-full md:w-[75%] md:ml-[12.5%]">
        <h3 className="text-2xl text-emerald-400 font-semibold md:mb-4 px-4">
          V1 Vaults
        </h3>
        <Vaults vaults={partnershipVaults} />
      </div>
    </div>
  );
});

ExampleUI.displayName = "ExampleUI";

export default ExampleUI;
