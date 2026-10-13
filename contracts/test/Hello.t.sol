// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {Hello} from "../src/Hello.sol";

contract HelloTest is Test {
    Hello hello;

    function setUp() public {
        hello = new Hello();
    }

    function test_Ping() public view {
        assertEq(hello.ping(), "Chog Track");
    }

    function test_GreetingImmutable() public view {
        assertEq(hello.GREETING(), "Chog Track");
    }
}
