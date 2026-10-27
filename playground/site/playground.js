// With ?fill=20000 in the address, add that many small items at the end of the main part of the page.
const count = Number(new URLSearchParams(location.search).get("fill"));
const main = document.querySelector("main");
if (count > 0 && main) {
  for (let i = 1; i <= count; i++) {
    const item = document.createElement("div");
    item.className = "fill-item";
    item.textContent = `Extra item ${i}`;
    main.append(item);
  }
}
