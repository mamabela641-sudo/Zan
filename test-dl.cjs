async function test() {
  const res = await fetch("https://rh-hk-images-switch.xiaoyaoyou.com/input/api/61a7fa368dbaa045cac36526c6eefb1ea7de1f71b86956ec711994d7f90a5d39.json");
  console.log("Status:", res.status);
  console.log(await res.text());
}
test();
