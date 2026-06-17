import { randomInt, randomUUID } from "node:crypto";
import type {
  EasyPosBillKeys,
  EasyPosBillMetadata,
  EasyPosBillPayload,
  EasyPosBuildBillInput,
} from "./types";

const PRODUCT_IDS = {
  diamond: 11594623,
  star: 11588154,
} as const;

const RANDOM_KEY_CHARACTERS = "abcdefghijklmnopqrstuvwxyz0123456789";
const EASY_POS_TIME_ZONE = "Asia/Ho_Chi_Minh";

const diamondTemplate = {
  products: [
    {
      productId: PRODUCT_IDS.diamond,
      imageUrl:
        "https://app.easyposs.vn/client/file/product/43228/43228_20260612180647897_0.jpg",
      productProductUnitId: 11704428,
      productName: "Kim cương ứng dụng Litmatch",
      productCode: "SP8",
      quantity: 270,
      inventoryCount: 0,
      unit: "Viên",
      unitId: 1886341,
      unitPrice: 37.037037,
      unitPriceOrigin: 37.037037,
      outPriceTax: 0,
      discountAmount: 0,
      amount: 10000,
      totalPreTax: 10000,
      vatRate: -1,
      vatRateName: "Áp dụng thuế",
      vatAmount: 0,
      inventoryTracking: false,
      totalAmount: 10000,
      feature: 1,
      typeDiscount: "Giảm theo giá trị",
      discountRate: 0,
      position: 1,
      displayAmount: 10000,
      productNameCustom: "",
      groupBatch: "x441p2y1bpffszxeti5k",
      discountVatRate: null,
      totalDiscount: null,
      displayVatAmount: 0,
      displayTotalAmount: 10000,
      voucherProducts: [],
      productExtra: null,
      warehouseId: 55325,
      warehouseName: "Kho bán hàng",
      batchId: null,
      batchOnHands: null,
      batchOnHandsInitial: null,
      hasBatch: 0,
      toppings: [],
      combos: [],
      idMedicine: "",
      idMedicineSale: null,
      licensePlates: "",
      treatmentProducts: [],
      type: 0,
      description: "",
      isImeiSerialManagement: false,
      imeiSerials: [],
      checkin: null,
      careerTax:
        '"{\\"career_tax_id\\":\\"691b68bbaf396e70fb5849e7\\",\\"career_vat_rate\\":1,\\"personal_tax_rate\\":0.5}"',
      batchIdInitial: null,
      autoUpdateProductVoucher: true,
      inputWidth: 65,
      totalAmountTopping: 0,
      displayAmountOriginal: 10000,
      totalAmountProduct: 10000,
      warranties: [],
      selectedWarranties: [],
      promoValid: false,
      _editingQuantity: false,
      checkout: null,
      expiredAt: null,
    },
  ],
  vouchers: [],
  comId: 43228,
  payment: { paymentMethod: "Chuyển khoản", amount: 10000 },
  deliveryType: 2,
  taxAuthorityCode: "M2-26-RVWOC-17817181082",
  billDate: "2026-06-18 00:41:48",
  status: 1,
  countProduct: 1,
  vatRate: -1,
  amount: 10000,
  discountAmount: 0,
  totalPreTax: 10000,
  vatAmount: 0,
  totalAmount: 10000,
  voucherAmount: 0,
  quantity: 270,
  typeInv: 0,
  checkboxVatRateDiscountProduct: false,
  vatRateDiscountProductName: "",
  haveDiscountVat: false,
  checkSPDV: false,
  surcharges: [],
  extraConfig: { svc5: 0 },
  billDetailResponse: false,
  extra: { noteOnInvoice: false },
  priceListId: 46042,
  discountVatRate: 0,
  code: "ĐH 1",
  configPos: {
    index: true,
    image: true,
    unit: true,
    unitPrice: true,
    vatAmount: true,
    discount: true,
    note: true,
    productCode: true,
    sort: "productId desc",
    confirmSaveOrder: true,
    scanBarCode: false,
    suggestionCheckout: false,
    outPriceTax: false,
    topProduct: false,
  },
  exciseTaxAmount: 0,
  exciseTaxRate: null,
  productDiscountAmount: 0,
  statusOrder: true,
  discountVatAmount: 0,
  productTaxAmount: 0,
  customerId: 4089100,
  customerName: "Khách lẻ",
  buyerName: null,
  customerAddress: null,
  customerTaxCode: null,
  pointBalanceCustomer: 0,
  moneyBalanceCustomer: 0,
  cardCustomerInfo: null,
  totalSurcharge: 0,
  surchargeVatAmount: 0,
  paymentMethod: "Chuyển khoản",
  uniqueKey: "59719f54-79bf-4c97-87e8-148f086a480f",
  idempotencyKey: "9eded7c9-7520-445b-8eaf-a48744fab618",
  fkey: "54rq7t6huae9",
  checkIn: null,
  checkOut: null,
} satisfies EasyPosBillPayload;

const starTemplate = {
  ...diamondTemplate,
  products: [
    {
      ...diamondTemplate.products[0],
      productId: PRODUCT_IDS.star,
      imageUrl:
        "https://app.easyposs.vn/client/file/product/43228/43228_20260612180636754_0.jpg",
      productProductUnitId: 11697754,
      productName: "Xu ứng dụng Litmatch",
      productCode: "SP7",
      quantity: 540000,
      unit: "xu",
      unitId: 1890510,
      unitPrice: 3.703704,
      unitPriceOrigin: 3.703704,
      amount: 2000000,
      totalPreTax: 2000000,
      totalAmount: 2000000,
      displayAmount: 2000000,
      groupBatch: "jxzz1qi7h4plmjt5gxxt",
      displayTotalAmount: 2000000,
      careerTax: null,
      inputWidth: 80,
      displayAmountOriginal: 2000000,
      totalAmountProduct: 2000000,
      _editingQuantity: true,
    },
  ],
  payment: { paymentMethod: "Chuyển khoản", amount: 2000000 },
  taxAuthorityCode: "M2-26-RVWOC-17817192115",
  billDate: "2026-06-18 01:00:11",
  amount: 2000000,
  totalPreTax: 2000000,
  totalAmount: 2000000,
  quantity: 540000,
  uniqueKey: "f6f15fea-1209-46fa-ba44-10d139f3b26a",
  idempotencyKey: "60401bd6-0d8d-491e-a575-06c74c305159",
  fkey: "0k25uwm86lvh",
} satisfies EasyPosBillPayload;

function cloneTemplate(template: EasyPosBillPayload): EasyPosBillPayload {
  return JSON.parse(JSON.stringify(template)) as EasyPosBillPayload;
}

function randomAlphaNumeric(length: number) {
  let value = "";

  for (let index = 0; index < length; index += 1) {
    value += RANDOM_KEY_CHARACTERS[randomInt(RANDOM_KEY_CHARACTERS.length)];
  }

  return value;
}

function formatEasyPosBillDate(date: Date) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: EASY_POS_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const values = Object.fromEntries(
    parts.map((part) => [part.type, part.value]),
  );

  return `${values.year}-${values.month}-${values.day} ${values.hour}:${values.minute}:${values.second}`;
}

function roundUnitPrice(amount: number, quantity: number) {
  return Number((amount / quantity).toFixed(6));
}

export function buildEasyPosBillKeys(input: {
  taxAuthorityPrefix: string;
  now?: Date;
}): EasyPosBillKeys {
  const now = input.now ?? new Date();
  const taxAuthorityPrefix = input.taxAuthorityPrefix.replace(/-+$/, "");
  const timestamp = Math.floor(now.getTime() / 1000);

  return {
    uniqueKey: randomUUID(),
    idempotencyKey: randomUUID(),
    fkey: randomAlphaNumeric(12),
    code: `ĐH ${timestamp}${randomInt(100, 999)}`,
    billDate: formatEasyPosBillDate(now),
    taxAuthorityCode: `${taxAuthorityPrefix}-${timestamp}${randomInt(100, 999)}`,
    groupBatch: randomAlphaNumeric(20),
  };
}

export function getEasyPosBillMetadata(
  input: EasyPosBuildBillInput,
): EasyPosBillMetadata {
  return {
    productId: PRODUCT_IDS[input.rewardType],
    quantity: input.quantity,
    amount: input.amount,
  };
}

export function buildEasyPosBillPayload(
  input: EasyPosBuildBillInput,
): EasyPosBillPayload {
  const payload = cloneTemplate(
    input.rewardType === "diamond" ? diamondTemplate : starTemplate,
  );
  const product = payload.products[0];
  const unitPrice = roundUnitPrice(input.amount, input.quantity);

  product.productId = PRODUCT_IDS[input.rewardType];
  product.quantity = input.quantity;
  product.unitPrice = unitPrice;
  product.unitPriceOrigin = unitPrice;
  product.amount = input.amount;
  product.totalPreTax = input.amount;
  product.totalAmount = input.amount;
  product.displayAmount = input.amount;
  product.displayTotalAmount = input.amount;
  product.displayAmountOriginal = input.amount;
  product.totalAmountProduct = input.amount;
  product.groupBatch = input.keys.groupBatch;

  payload.payment.amount = input.amount;
  payload.amount = input.amount;
  payload.totalPreTax = input.amount;
  payload.totalAmount = input.amount;
  payload.quantity = input.quantity;
  payload.taxAuthorityCode = input.keys.taxAuthorityCode;
  payload.billDate = input.keys.billDate;
  payload.code = input.keys.code;
  payload.uniqueKey = input.keys.uniqueKey;
  payload.idempotencyKey = input.keys.idempotencyKey;
  payload.fkey = input.keys.fkey;

  return payload;
}
